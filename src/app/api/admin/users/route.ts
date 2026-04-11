import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { getCookieName } from '@/lib/csrf'

// Helper: attempt to decrypt contact info, safe on failure
async function safeDecryptContact(encrypted: string | null | undefined, contactType: string | null): Promise<{ type: string | null; info: string | null }> {
  if (!encrypted || !contactType) return { type: null, info: null }
  try {
    const info = await decrypt(String(encrypted))
    return { type: contactType, info }
  } catch {
    // 解密失败时不泄露任何加密原文片段，只返回通用提示
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
      const result = await db.execute({
        sql: `SELECT u.id, u.nickname, u.gender,
                u.survey_completed, u.match_enabled,
                u.created_at, u.invited_by,
                (SELECT COUNT(*) FROM invite_codes WHERE created_by = u.id AND current_uses < max_uses) as remaining_codes,
                inv.nickname as invited_by_name
              FROM users u LEFT JOIN users inv ON u.invited_by = inv.id
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

    // Get basic user info
    const userResult = await db.execute({
      sql: `SELECT id, nickname, email, gender, preferred_gender, conflict_type,
                is_admin, survey_completed, match_enabled, contact_type,
                created_at FROM users WHERE id = ?`,
      args: [uid],
    })
    const userRow = userResult.rows[0] as any
    if (!userRow) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    // Get contact info (decrypted)
    const contact = await safeDecryptContact(
      (await db.execute({ sql: 'SELECT contact_info FROM users WHERE id = ?', args: [uid] })).rows[0]?.contact_info as string | null,
      userRow.contact_type
    )

    // Get survey answers
    let surveyAnswers: Record<string, string> | null = null
    if (userRow.survey_completed) {
      const surveyResult = await db.execute({
        sql: `SELECT q1,q2,q3,q4,q5,q6,q7,q8,q9,q10,q11,q12,
                  q13,q14,q15,q16,q17,q18,q19,q20,q21,q22,q23,q24,
                  q25,q26,q27,q28,q29,q30,q31,q32, updated_at
               FROM survey_responses WHERE user_id = ?`,
        args: [uid],
      })
      if (surveyResult.rows.length > 0) {
        surveyAnswers = {}
        for (let i = 1; i <= 32; i++) {
          const val = (surveyResult.rows[0] as any)[`q${i}`]
          if (val) (surveyAnswers as Record<string, string>)[`q${i}`] = String(val)
        }
        ;(surveyAnswers as any).updatedAt = (surveyResult.rows[0] as any).updated_at
      }
    }

    return NextResponse.json({
      user: {
        id: Number(userRow.id),
        nickname: userRow.nickname,
        email: userRow.email,
        gender: userRow.gender,
        preferredGender: userRow.preferred_gender,
        safetyLevel: 'normal',
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
