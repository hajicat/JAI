import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { getCookieName } from '@/lib/csrf'

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

    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const userId = req.nextUrl.searchParams.get('id')

    const db = getDb()

    // No id → return user list
    if (!userId) {
      const result = await db.execute({
        sql: `SELECT u.id, u.nickname, u.email, u.gender, u.preferred_gender,
                u.survey_completed, u.match_enabled, u.is_admin,
                u.created_at, u.invited_by,
                (SELECT COUNT(*) FROM invite_codes WHERE created_by = u.id AND current_uses < max_uses) as remaining_codes,
                inv.nickname as invited_by_name
              FROM users u LEFT JOIN users inv ON u.invited_by = inv.id
              ORDER BY u.created_at DESC`,
        args: [],
      })
      return NextResponse.json({
        users: result.rows.map((row: any) => ({
          id: row.id,
          nickname: row.nickname,
          email: row.email,
          gender: row.gender,
          preferred_gender: row.preferred_gender,
          safety_level: 'normal',  // 安全等级在匹配引擎中动态计算
          survey_completed: !!row.survey_completed,
          match_enabled: !!row.match_enabled,
          is_admin: !!row.is_admin,
          remaining_codes: Number(row.remaining_codes) || 0,
          invited_by_name: row.invited_by_name,
          created_at: row.created_at,
        })),
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
    let contactInfo = null
    if (userRow.contact_type && !userRow.is_admin) {
      // Need to get encrypted contact_info separately since it's not in the SELECT above
      const contactResult = await db.execute({
        sql: 'SELECT contact_info FROM users WHERE id = ?',
        args: [uid],
      })
      const encryptedContact = (contactResult.rows[0] as any)?.contact_info
      if (encryptedContact) {
        try {
          contactInfo = await decrypt(String(encryptedContact))
        } catch {
          contactInfo = '[解密失败]'
        }
      }
    }

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
        contactType: userRow.contact_type,
        contactInfo: contactInfo,
        createdAt: userRow.created_at,
      },
      survey: surveyAnswers,
    })
  } catch (error: any) {
    console.error('[admin/user-detail]', error?.message || error)
    return NextResponse.json({ error: '获取用户详情失败' }, { status: 500 })
  }
}
