import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb, CAMPUS_LAT, CAMPUS_LNG, CAMPUS_RADIUS_KM } from '@/lib/db'
import { hashPassword, createToken, generateInviteCode } from '@/lib/auth'
import { validateEmail, validatePassword, validateNickname, validateInviteCode, sanitizeString } from '@/lib/validation'
import { checkRateLimit, REGISTER_LIMITER } from '@/lib/rate-limit'
import { getClientIp, setCsrfCookie, getCookieName, validateCsrfToken } from '@/lib/csrf'
import { haversineDistance } from '@/lib/geo'

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // CSRF protection
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = checkRateLimit(ip, REGISTER_LIMITER, 'register')
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

    // Check invite code
    const codeResult = await db.execute({
      sql: 'SELECT * FROM invite_codes WHERE code = ? AND current_uses < max_uses',
      args: [inviteCode],
    })
    const codeRow = codeResult.rows[0] as any
    if (!codeRow) {
      return NextResponse.json({ error: '邀请码无效或已用完' }, { status: 400 })
    }

    // Check email exists
    const existingResult = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email],
    })
    if (existingResult.rows.length > 0) {
      return NextResponse.json({ error: '该邮箱已注册' }, { status: 400 })
    }

    // Create user
    const passwordHash = await hashPassword(password)
    const userInviteCode = generateInviteCode()

    const insertResult = await db.execute({
      sql: `INSERT INTO users (nickname, email, password_hash, invite_code, invited_by, gender, preferred_gender)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [nickname, email, passwordHash, userInviteCode, Number(codeRow.created_by), gender, preferredGender],
    })

    const newUserId = Number(insertResult.lastInsertRowid)

    // Update invite code usage
    await db.execute({
      sql: 'UPDATE invite_codes SET current_uses = current_uses + 1, used_by = ? WHERE id = ?',
      args: [newUserId, Number(codeRow.id)],
    })

    // Give new user 3 invite codes
    for (let i = 0; i < 3; i++) {
      const code = generateInviteCode()
      await db.execute({
        sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
        args: [code, newUserId],
      })
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

    return setCsrfCookie(response)
  } catch (error: any) {
    console.error('[register]', error?.message || error)
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 })
  }
}
