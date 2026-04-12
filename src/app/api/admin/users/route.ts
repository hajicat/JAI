import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { getCookieName } from '@/lib/csrf'
import { validateCsrfToken } from '@/lib/csrf'
import { calcSafety } from '@/lib/match-engine'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/csrf'

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
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const userId = req.nextUrl.searchParams.get('id')

    // No id → return user list (paginated)
    if (!userId) {
      // ?all=1: return all users without pagination (for match dropdown)
      if (req.nextUrl.searchParams.get('all') === '1') {
        const allResult = await db.execute({
          sql: `SELECT u.id, u.nickname, u.gender, u.survey_completed
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
                u.created_at, u.invited_by,
                (SELECT COUNT(*) FROM invite_codes WHERE created_by = u.id AND current_uses < max_uses) as remaining_codes,
                inv.nickname as invited_by_name,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q21
              FROM users u LEFT JOIN users inv ON u.invited_by = inv.id
              LEFT JOIN survey_responses s ON u.id = s.user_id
              ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        args: [pageSize, offset],
      })

      const userList = result.rows.map((row: any) => ({
        id: row.id,
        nickname: row.nickname,
        gender: row.gender,
        survey_completed: !!row.survey_completed,
        match_enabled: !!row.match_enabled,
        remaining_codes: Number(row.remaining_codes) || 0,
        invited_by_name: row.invited_by_name,
        created_at: row.created_at,
        // 计算真实安全等级（使用 match-engine 导出的统一函数）
        safety_level: row.survey_completed ? calcSafety(row).level : null,
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
        createdAt: userRow.created_at,
      },
      survey: surveyAnswers,
    })
  } catch (error) {
    console.error('[admin/user-detail]', (error as any)?.message || error)
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
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

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

    // ── 检查用户是否存在 ──
    const userResult = await db.execute({
      sql: `SELECT id, nickname, is_admin FROM users WHERE id = ?`,
      args: [uid],
    })
    const targetUser = userResult.rows[0] as any
    if (!targetUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // ── 执行级联删除（按外键依赖顺序）──
    // 注意：所有外键约束必须先清理子表数据才能删主记录
    const nickname = targetUser.nickname

    // 0. 先获取目标用户的邮箱（用于后续删除验证码）
    const emailResult = await db.execute({
      sql: `SELECT email FROM users WHERE id = ?`,
      args: [uid],
    })
    const userEmail = (emailResult.rows[0] as any)?.email

    // 1. 删除匹配记录（作为 user_a 或 user_b）
    try { await db.execute({ sql: `DELETE FROM matches WHERE user_a = ? OR user_b = ?`, args: [uid, uid] }) } catch (_) {}

    // 2. 删除问卷回答
    try { await db.execute({ sql: `DELETE FROM survey_responses WHERE user_id = ?`, args: [uid] }) } catch (_) {}

    // 3. 删除验证码记录（避免子查询，直接用邮箱）
    if (userEmail) {
      try { await db.execute({ sql: `DELETE FROM verification_codes WHERE email = ?`, args: [userEmail] }) } catch (_) {}
    }

    // 4. 删除该用户创建的所有邀请码（包括已使用的）— created_by 外键
    try { await db.execute({ sql: `DELETE FROM invite_codes WHERE created_by = ?`, args: [uid] }) } catch (_) {}

    // 5. 删除该用户使用过的邀请码的引用 — used_by 外键（设为 NULL 而非删除整行）
    try { await db.execute({ sql: `UPDATE invite_codes SET used_by = NULL WHERE used_by = ?`, args: [uid] }) } catch (_) {}

    // 6. 更新被该用户邀请的人的 invited_by 为 NULL
    try { await db.execute({ sql: `UPDATE users SET invited_by = NULL WHERE invited_by = ?`, args: [uid] }) } catch (_) {}

    // 7. 最后删除用户本身
    const deleteResult = await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [uid] })

    // 校验是否真的删掉了（兼容 libSQL 返回值格式）
    const affectedRows = (deleteResult as any)?.rowsAffected ?? Number((deleteResult as any)?.rowsAffectedCount) ?? 1
    if (affectedRows === 0 && typeof affectedRows === 'number') {
      throw new Error('删除失败：未找到该用户')
    }

    console.log(`[admin/delete-user] 管理员 ${decoded.id} 删除了用户 ${uid} (${nickname})`)

    return NextResponse.json({
      success: true,
      message: `已删除用户「${nickname}」`,
    })
  } catch (error) {
    console.error('[admin/delete-user]', (error as any)?.message || error)
    return NextResponse.json({ error: '删除用户失败' }, { status: 500 })
  }
}
