import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { getCookieName } from '@/lib/csrf'

// Helper: attempt to decrypt contact info, return raw on failure
async function safeDecryptContact(encrypted: string | null | undefined, contactType: string | null): Promise<{ type: string | null; info: string | null }> {
  if (!encrypted || !contactType) return { type: null, info: null }
  try {
    const info = await decrypt(String(encrypted))
    return { type: contactType, info }
  } catch {
    // Decryption failed — return raw prefix for debugging
    const preview = String(encrypted).substring(0, 20) + '...'
    return { type: contactType, info: `[解密失败] 原文:${preview}` }
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

    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const userId = req.nextUrl.searchParams.get('id')

    const db = getDb()

    // No id → return user list
    if (!userId) {
      const result = await db.execute({
        sql: `SELECT u.id, u.nickname, u.email, u.gender, u.preferred_gender,
                u.survey_completed, u.match_enabled, u.is_admin,
                u.created_at, u.invited_by, u.contact_type, u.contact_info,
                (SELECT COUNT(*) FROM invite_codes WHERE created_by = u.id AND current_uses < max_uses) as remaining_codes,
                inv.nickname as invited_by_name
              FROM users u LEFT JOIN users inv ON u.invited_by = inv.id
              ORDER BY u.created_at DESC`,
        args: [],
      })

      // Decrypt contact info for all users in parallel (admin can see everything)
      const usersWithContact = await Promise.all(
        result.rows.map(async (row: any) => {
          const contact = await safeDecryptContact(row.contact_info, row.contact_type)
          return {
            id: row.id,
            nickname: row.nickname,
            email: row.email,
            gender: row.gender,
            preferred_gender: row.preferred_gender,
            safety_level: 'normal',
            survey_completed: !!row.survey_completed,
            match_enabled: !!row.match_enabled,
            is_admin: !!row.is_admin,
            remaining_codes: Number(row.remaining_codes) || 0,
            invited_by_name: row.invited_by_name,
            created_at: row.created_at,
            contactType: contact.type,
            contactInfo: contact.info,
          }
        })
      )

      return NextResponse.json({ users: usersWithContact })
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
  } catch (error: any) {
    console.error('[admin/user-detail]', error?.message || error)
    return NextResponse.json({ error: '获取用户详情失败' }, { status: 500 })
  }
}
