import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb, CAMPUS_LAT, CAMPUS_LNG, CAMPUS_RADIUS_KM } from '@/lib/db'
import { hashPassword, createToken, generateInviteCode } from '@/lib/auth'
import { validateEmail, validatePassword, validateNickname, validateInviteCode, sanitizeString } from '@/lib/validation'
import { checkRateLimit, REGISTER_LIMITER, checkRateLimitByEmail, EMAIL_REGISTER_LIMITER } from '@/lib/rate-limit'
import { getClientIp, setCsrfCookie, getCookieName, validateCsrfToken } from '@/lib/csrf'
import { haversineDistance } from '@/lib/geo'
import { verifyCode } from '@/lib/email'

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // CSRF protection
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, REGISTER_LIMITER, 'register')
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: '注册太频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(rateResult.retryAfter) } }
      )
    }

    const body = await req.json()
    const nickname = sanitizeString(body.nickname || '', 20)
    const email = sanitizeString(body.email || '', 254).toLowerCase()
    const password = body.password || ''
    const inviteCode = (typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '').toUpperCase()
    const gender = sanitizeString(body.gender || '', 10)
    const preferredGender = sanitizeString(body.preferredGender || '', 20)
    const latitude = body.latitude
    const longitude = body.longitude

    // --- GPS Verification (可由管理员在后台开关) ---
    const db = getDb()
    await initDb()

    // 检查 GPS 是否必需
    let gpsEnabled = true
    try {
      const settingsRow = await db.execute("SELECT value FROM settings WHERE key = 'gpsRequired'")
      if (settingsRow.rows.length > 0) {
        gpsEnabled = settingsRow.rows[0].value !== '0' && settingsRow.rows[0].value !== 'false'
      }
    } catch {
      /* 表不存在则默认开启 */
    }

    if (gpsEnabled) {
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return NextResponse.json({ error: '请先在页面上完成GPS校内验证（点击"点击验证位置"按钮）' }, { status: 400 })
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return NextResponse.json({ error: '坐标范围无效' }, { status: 400 })
      }
      const distance = haversineDistance(latitude, longitude, CAMPUS_LAT, CAMPUS_LNG)
      if (distance > CAMPUS_RADIUS_KM) {
        return NextResponse.json({
          error: `你不在吉林动画学院附近（距离约${Math.round(distance * 100) / 100}km，需要在${CAMPUS_RADIUS_KM}km内）`,
        }, { status: 403 })
      }
    }

    // --- Input Validation ---
    const nicknameCheck = validateNickname(nickname)
    if (!nicknameCheck.valid) return NextResponse.json({ error: nicknameCheck.error }, { status: 400 })

    const emailCheck = validateEmail(email)
    if (!emailCheck.valid) return NextResponse.json({ error: emailCheck.error }, { status: 400 })

    const passwordCheck = validatePassword(password)
    if (!passwordCheck.valid) return NextResponse.json({ error: passwordCheck.error }, { status: 400 })

    const codeCheck = validateInviteCode(inviteCode)
    if (!codeCheck.valid) return NextResponse.json({ error: codeCheck.error }, { status: 400 })

    // Validate gender
    if (!['male', 'female', 'other'].includes(gender)) {
      return NextResponse.json({ error: '请选择你的性别' }, { status: 400 })
    }
    if (!['male', 'female', 'all'].includes(preferredGender)) {
      return NextResponse.json({ error: '请选择你想匹配的性别' }, { status: 400 })
    }

    // Check invite code + atomic usage increment (TOCTOU fix)
    // 使用原子操作：在单条 SQL 中检查并递增使用计数，防止并发竞态
    const updateResult = await db.execute({
      sql: `UPDATE invite_codes SET current_uses = current_uses + 1
            WHERE code = ? AND current_uses < max_uses`,
      args: [inviteCode],
    })
    if (!updateResult.rowsAffected || (updateResult as any).rowsAffected === 0) {
      return NextResponse.json({ error: '邀请码无效或已用完' }, { status: 400 })
    }
    // 获取完整的邀请码记录（用于后续 created_by 检查）
    const codeResult = await db.execute({
      sql: 'SELECT * FROM invite_codes WHERE code = ?',
      args: [inviteCode],
    })
    const codeRow = codeResult.rows[0] as any
    if (!codeRow) {
      return NextResponse.json({ error: '邀请码记录不存在' }, { status: 400 })
    }

    // 验证 created_by 对应的用户是否存在（防止 FK 约束失败）
    const createdBy = Number(codeRow.created_by)
    if (!createdBy || createdBy <= 0 || isNaN(createdBy)) {
      return NextResponse.json({ error: '邀请码数据异常，请联系管理员' }, { status: 400 })
    }
    const creatorCheck = await db.execute({
      sql: 'SELECT id FROM users WHERE id = ?',
      args: [createdBy],
    })
    if (creatorCheck.rows.length === 0) {
      console.error('[register] 邀邀码 created_by 指向不存在的用户:', { code: inviteCode, createdBy })
      return NextResponse.json({ error: '邀请码无效（关联用户不存在），请联系管理员' }, { status: 400 })
    }

    // ── 邮箱验证码校验（注册必须先验证邮箱）──
    const verificationCode = body.verificationCode || ''
    if (!verificationCode || typeof verificationCode !== 'string') {
      return NextResponse.json({ error: '请先获取并输入邮箱验证码' }, { status: 400 })
    }
    const verifyResult = await verifyCode(email, verificationCode, db)
    if (!verifyResult.valid) {
      return NextResponse.json({ error: verifyResult.error }, { status: 400 })
    }

    // 防自邀注册：不能使用自己的邀请码注册新账号
    const creatorResult = await db.execute({
      sql: 'SELECT email FROM users WHERE id = ?',
      args: [Number(codeRow.created_by)],
    })
    if (creatorResult.rows.length > 0) {
      const creatorEmail = ((creatorResult.rows[0] as any).email || '').toLowerCase()
      if (creatorEmail === email) {
        return NextResponse.json({ error: '不能使用自己的邀请码注册' }, { status: 400 })
      }
    }

    // Check email exists (case-insensitive)
    const existingResult = await db.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [email],
    })
    if (existingResult.rows.length > 0) {
      return NextResponse.json({ error: '该邮箱已注册' }, { status: 400 })
    }

    // 邮箱维度限流（放在所有校验通过之后，避免输入错误消耗计数）
    const emailRateResult = await checkRateLimitByEmail(email, EMAIL_REGISTER_LIMITER, 'register')
    if (!emailRateResult.allowed) {
      return NextResponse.json(
        { error: '该邮箱今日注册次数已达上限' },
        { status: 429, headers: { 'Retry-After': String(emailRateResult.retryAfter) } }
      )
    }

    // Create user
    const passwordHash = await hashPassword(password)
    const userInviteCode = generateInviteCode()

    const insertResult = await db.execute({
      sql: `INSERT INTO users (nickname, email, password_hash, invite_code, invited_by, gender, preferred_gender, email_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      args: [nickname, email, passwordHash, userInviteCode, Number(codeRow.created_by), gender, preferredGender],
    })

    const newUserId = Number(insertResult.lastInsertRowid)

    // Update invite code: set used_by to new user (current_uses already atomically incremented)
    await db.execute({
      sql: 'UPDATE invite_codes SET used_by = ? WHERE id = ?',
      args: [newUserId, Number(codeRow.id)],
    })

    // Give new user 3 invite codes (batch insert)
    const newUserCodes: Array<{ sql: string; args: any[] }> = []
    for (let i = 0; i < 3; i++) {
      const code = generateInviteCode()
      newUserCodes.push({
        sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
        args: [code, newUserId],
      })
    }
    try { await db.batch(newUserCodes) } catch (_) {
      // fallback to individual inserts if batch not supported
      for (const stmt of newUserCodes) {
        try { await db.execute(stmt) } catch (__) { /* ignore */ }
      }
    }

    const token = await createToken({ id: newUserId, email, isAdmin: false })

    const response = NextResponse.json({
      success: true,
      user: { id: newUserId, nickname, email, inviteCode: userInviteCode },
    })

    const cookieName = getCookieName('token')
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    // 非敏感状态 cookie：前端同步读取，新用户默认 pending
    response.cookies.set('logged_in', 'true', {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
    response.cookies.set('survey_status', 'pending', {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return setCsrfCookie(response)
  } catch (error: any) {
    const errMsg = error?.message || error || 'unknown'
    console.error('[register]', errMsg)
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    )
  }
}
