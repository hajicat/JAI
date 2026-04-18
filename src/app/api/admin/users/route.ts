import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { getCookieName } from '@/lib/csrf'
import { validateCsrfToken } from '@/lib/csrf'
import { calcSafety } from '@/lib/match-engine'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/csrf'
import { verifyPassword as verifyAdminPassword } from '@/lib/auth'

// Helper: attempt to decrypt contact info, safe on failure
async function safeDecryptContact(encrypted: string | null | undefined, contactType: string | null): Promise<{ type: string | null; info: string | null }> {
  if (!encrypted || !contactType) return { type: null, info: null }
  try {
    const info = await decrypt(String(encrypted))
    return { type: contactType, info }
  } catch {
    return { type: contactType, info: `[解密失败，请检查 ENCRYPT_SECRET 配置]` }
  }
}

export const runtime = 'edge';

/**
 * Admin-only endpoint: get user details including contact info and survey answers
 * GET /api/admin/users/[id]  or  GET /api/admin/users?id=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const userId = req.nextUrl.searchParams.get('id')

    // No id → return user list (paginated)
    if (!userId) {
      // ?all=1: return all users without pagination (for match dropdown)
      if (req.nextUrl.searchParams.get('all') === '1') {
        const allResult = await db.execute({
          sql: `SELECT u.id, u.nickname, u.gender, u.survey_completed, u.verification_status
                FROM users u ORDER BY u.created_at DESC`,
          args: [],
        })
        return NextResponse.json({ users: allResult.rows })
      }

      const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
      const pageSize = 10
      const offset = (page - 1) * pageSize

      // Get total count
      const countResult = await db.execute({ sql: 'SELECT COUNT(*) as total FROM users', args: [] })
      const totalCount = Number((countResult.rows[0] as any).total) || 0
      const totalPages = Math.ceil(totalCount / pageSize)

      // Get paginated users (no contact info in list for security)
      // JOIN survey_responses to get safety question answers for safety level calculation
      const result = await db.execute({
        sql: `SELECT u.id, u.nickname, u.gender,
                u.survey_completed, u.match_enabled,
                u.verification_status, u.verification_score,
                u.created_at, u.invited_by,
                (SELECT COUNT(*) FROM invite_codes WHERE created_by = u.id AND current_uses < max_uses) as remaining_codes,
                inv.nickname as invited_by_name,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q21
              FROM users u LEFT JOIN users inv ON u.invited_by = inv.id
              LEFT JOIN survey_responses s ON u.id = s.user_id
              ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        args: [pageSize, offset],
      })

      const VERIFY_LABELS: Record<string, { label: string; color: string }> = {
        verified_student:      { label: '✅ 已验证', color: 'text-green-600' },
        pending_verification:  { label: '⏳ 待验证', color: 'text-yellow-600' },
        verification_failed:   { label: '❌ 未通过', color: 'text-red-500' },
      }

      const userList = result.rows.map((row: any) => ({
        id: row.id,
        nickname: row.nickname,
        gender: row.gender,
        survey_completed: !!row.survey_completed,
        match_enabled: !!row.match_enabled,
        verification_status: row.verification_status || null,
        verification_score: row.verification_score,
        remaining_codes: Number(row.remaining_codes) || 0,
        invited_by_name: row.invited_by_name,
        created_at: row.created_at,
        // 计算真实安全等级（使用 match-engine 导出的统一函数）
        safety_level: row.survey_completed ? calcSafety(row).level : null,
        _verifyLabel: VERIFY_LABELS[row.verification_status || ''] || { label: '—', color: 'text-gray-400' },
      }))

      return NextResponse.json({
        users: userList,
        pagination: { page, pageSize, totalPages, totalCount },
      })
    }

    const uid = Number(userId)
    if (!Number.isInteger(uid) || uid <= 0) {
      return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
    }

    // Get basic user info (含 contact_info，不再单独查询)
    const userResult = await db.execute({
      sql: `SELECT id, nickname, email, gender, preferred_gender, conflict_type,
                is_admin, survey_completed, match_enabled, contact_type, contact_info,
                verification_status, verification_score, verified_at,
                school, match_school_prefs,
                created_at FROM users WHERE id = ?`,
      args: [uid],
    })
    const userRow = userResult.rows[0] as any
    if (!userRow) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    // Get contact info (decrypted) — 直接从主查询取
    const contact = await safeDecryptContact(userRow.contact_info, userRow.contact_type)

    // Get survey answers
    let surveyAnswers: Record<string, string> | null = null
    let safetyLevel = 'normal'
    if (userRow.survey_completed) {
      const surveyResult = await db.execute({
        sql: `SELECT q1,q2,q3,q4,q5,q6,q7,q8,q9,q10,q11,q12,
                  q13,q14,q15,q16,q17,q18,q19,q20,q21,q22,q23,q24,
                  q25,q26,q27,q28,q29,q30,q31,q32, updated_at
               FROM survey_responses WHERE user_id = ?`,
        args: [uid],
      })
      if (surveyResult.rows.length > 0) {
        const sRow = surveyResult.rows[0] as any
        surveyAnswers = {}
        for (let i = 1; i <= 35; i++) {
          const val = sRow[`q${i}`]
          if (val) (surveyAnswers as Record<string, string>)[`q${i}`] = String(val)
        }
        ;(surveyAnswers as any).updatedAt = sRow.updated_at
        // 用问卷答案计算真实安全等级（使用 match-engine 统一函数）
        safetyLevel = calcSafety(sRow).level
      }
    }

    // 解析 match_school_prefs：'all' → 全选数组，JSON字符串 → 解析
    const prefsRaw = userRow.match_school_prefs || 'all'
    let parsedPrefs: string[]
    if (prefsRaw === 'all') {
      parsedPrefs = ['吉林大学', '东北师范大学', '吉林外国语大学', '吉林动画学院', '长春大学']
    } else {
      try { parsedPrefs = JSON.parse(prefsRaw) }
      catch { parsedPrefs = [] }
    }

    return NextResponse.json({
      user: {
        id: Number(userRow.id),
        nickname: userRow.nickname,
        email: userRow.email,
        gender: userRow.gender,
        preferredGender: userRow.preferred_gender,
        safetyLevel: safetyLevel,
        isAdmin: !!userRow.is_admin,
        surveyCompleted: !!userRow.survey_completed,
        matchEnabled: !!userRow.match_enabled,
        contactType: contact.type,
        contactInfo: contact.info,
        verificationStatus: userRow.verification_status || null,
        verificationScore: userRow.verification_score,
        verifiedAt: userRow.verified_at,
        school: userRow.school || null,
        matchSchoolPrefs: parsedPrefs,
        createdAt: userRow.created_at,
      },
      survey: surveyAnswers,
    })
  } catch (error) {
    console.error('[admin/user-detail]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取用户详情失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/users?id=xxx
 *
 * 删除指定用户（需管理员权限 + CSRF + 二级密码已在前端验证）
 * 级联删除：survey_responses, verification_codes, invite_codes(作为创建者), matches
 */
export async function DELETE(req: NextRequest) {
  try {
    // ── 身份验证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // ── 二级密码验证（防止 cookie 被盗后批量删除）──
    const { confirmPassword } = await req.json() as { confirmPassword?: string }
    if (!confirmPassword || typeof confirmPassword !== 'string') {
      return NextResponse.json({ error: '请输入管理员密码以确认删除' }, { status: 400 })
    }
    try {
      const pwResult = await db.execute({
        sql: "SELECT value FROM settings WHERE key = 'admin_view_password_hash'",
        args: [],
      })
      const pwRow = pwResult.rows[0] as any
      if (pwRow?.value && !(await verifyAdminPassword(confirmPassword, String(pwRow.value)))) {
        return NextResponse.json({ error: '管理员密码错误' }, { status: 403 })
      }
      // 如果还没设置过二级密码则放行（兼容旧部署）
    } catch (_) { /* 查询失败时继续 */ }

    // ── 限流（防止 cookie 被盗后批量删除）──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-delete-user')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁，请稍后再试' }, { status: 429 })
    }

    // ── 获取目标用户ID ──
    const userId = req.nextUrl.searchParams.get('id')
    const uid = Number(userId)
    if (!Number.isInteger(uid) || uid <= 0) {
      return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
    }

    // ── 不允许删除自己 ──
    if (uid === decoded.id) {
      return NextResponse.json({ error: '不能删除自己的账号' }, { status: 400 })
    }

    // ── 检查用户是否存在（同时获取邮箱用于后续清理验证码）──
    const userResult = await db.execute({
      sql: `SELECT id, nickname, is_admin, email FROM users WHERE id = ?`,
      args: [uid],
    })
    const targetUser = userResult.rows[0] as any
    if (!targetUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // ── 执行级联删除（事务保护，防止孤儿数据）──
    const nickname = targetUser.nickname
    const userEmail = targetUser.email

    // 构建批量操作（按外键依赖顺序）
    const batchStmts: Array<{ sql: string; args: any[] }> = [
      { sql: `DELETE FROM verification_samples WHERE user_id = ?`, args: [uid] },
      { sql: `DELETE FROM matches WHERE user_a = ? OR user_b = ?`, args: [uid, uid] },
      { sql: `DELETE FROM survey_responses WHERE user_id = ?`, args: [uid] },
      { sql: `DELETE FROM password_reset_tokens WHERE user_id = ?`, args: [uid] },
      { sql: `UPDATE invite_codes SET used_by = NULL WHERE used_by = ?`, args: [uid] },
      { sql: `UPDATE users SET invited_by = NULL WHERE invited_by = ?`, args: [uid] },
      { sql: `DELETE FROM invite_codes WHERE created_by = ?`, args: [uid] },
      { sql: `DELETE FROM users WHERE id = ?`, args: [uid] },
    ]

    // 验证码删除依赖 userEmail，有邮箱才加入
    if (userEmail) {
      batchStmts.splice(2, 0, { sql: `DELETE FROM verification_codes WHERE email = ?`, args: [userEmail] })
    }

    try {
      await db.batch(batchStmts)
    } catch (batchErr) {
      // fallback：如果 batch 不受支持，逐条执行
      for (const stmt of batchStmts) {
        try { await db.execute(stmt) } catch (_) {}
      }
    }

    console.log(`[admin/delete-user] uid=${uid} deleted by=${decoded.id}`)

    return NextResponse.json({
      success: true,
      message: `已删除用户「${nickname}」`,
    })
  } catch (error) {
    console.error('[admin/delete-user]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '删除用户失败' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/users?id=xxx
 * 更新指定用户的验证状态（管理员手动操作，无需二级密码）
 * Body: { verificationStatus: string; verificationScore?: number }
 */
export async function PATCH(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const userId = req.nextUrl.searchParams.get('id')
    const uid = Number(userId)
    if (!Number.isInteger(uid) || uid <= 0) {
      return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
    }

    const body = await req.json() as { verificationStatus?: string; verificationScore?: number }
    const { verificationStatus, verificationScore } = body

    const validStatuses = ['verified_student', 'pending_verification', 'verification_failed', 'null']
    if (!validStatuses.includes(verificationStatus as string)) {
      return NextResponse.json({ error: '无效的验证状态' }, { status: 400 })
    }

    // 检查用户是否存在
    const userResult = await db.execute({ sql: 'SELECT id, nickname FROM users WHERE id = ?', args: [uid] })
    if (!userResult.rows[0]) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    const nickname = (userResult.rows[0] as any).nickname
    // 确保无 undefined：undefined/null → null，其余直接用
    const statusValue: string | null =
      verificationStatus == null || verificationStatus === 'null' ? null : verificationStatus
    const scoreValue: number | null =
      verificationScore !== undefined ? Number(verificationScore) : null

    await db.execute({
      sql: `UPDATE users SET verification_status = ?, verification_score = ?` +
        (statusValue === 'verified_student' ? `, verified_at = datetime('now')` : `, verified_at = NULL`) +
        ` WHERE id = ?`,
      args: [statusValue, scoreValue, uid],
    })

    console.log(`[admin/patch-user] uid=${uid} verification_status=${statusValue} by=${decoded.id}`)

    return NextResponse.json({ success: true, message: `已将「${nickname}」的验证状态更新为「${statusValue || '未设置'}」` })
  } catch (error) {
    console.error('[admin/patch-user]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '更新失败' }, { status: 500 })
  }
}
