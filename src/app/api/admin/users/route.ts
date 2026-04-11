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

// ── 安全等级计算（从 admin/match/route.ts 复制，避免循环依赖）──
function calcUserSafety(u: any): string {
  const ansIdx = (qId: string, answer: string): number => {
    const map: Record<string, string[]> = {
      q1: ['会烦，但会先让自己稳住，再说明我现在不方便', '会直接表现出不耐烦，但事后能恢复正常', '很容易把火气撒到当时在场的人身上', '会记很久，之后态度也会变差'],
      q2: ['可以商量，但不是默认义务', '密码无所谓，定位长期共享没必要', '我希望彼此都保留独立隐私', '我想知道对方的，但不太想让对方知道我的'],
      q3: ['一着急就想马上说清楚', '先不说话，缓一缓再谈', '故意说重话，让对方也难受', '故意冷着对方，等TA先来低头'],
      q4: ['先把场面稳住，之后私下说朋友的问题', '先护住朋友情绪，但不会跟着一起攻击别人', '既然是我朋友，我肯定先一起对付外人', '赶紧躲开，别把麻烦沾到我身上'],
      q5: ['会觉得可怜，想办法给点吃的或求助', '有点想帮，但也会担心安全和卫生', '不敢接触，赶紧走开', '会拍个好玩的视频发给朋友吐槽一下'],
      q6: ['尊重，告诉TA需要我时找我', '会有点失落，但能理解', '会追问是不是我做错了什么', '会明显不高兴，觉得这就是在冷落我'],
      q7: ['不做，觉得没必要', '会犹豫，但大概率不想冒这个险', '如果大家都这么干，我也会', '能省事为什么不省，规则本来就是给人绕的'],
      q8: ['先攒钱，或者自己找额外收入', '找平替，等二手或降价', '分期先买了再说', '想办法让父母或对象给我买'],
      q21: ['合适的关系会让人自然变好', '可以调整习惯，但不能失去自己', '与其改造彼此，不如找更合适的人', '爱我就应该为我改变一些'],
    }
    return (map[qId] || []).indexOf(answer)
  }

  let risk = 0
  let hardBlock = false

  const a1 = ansIdx('q1', u.q1), a2 = ansIdx('q2', u.q2), a3 = ansIdx('q3', u.q3)
  const a4 = ansIdx('q4', u.q4), a5 = ansIdx('q5', u.q5), a6 = ansIdx('q6', u.q6)
  const a7 = ansIdx('q7', u.q7), a8 = ansIdx('q8', u.q8)
  const a21 = ansIdx('q21', u.q21)

  // 严重红旗 +3
  if (a2 === 3) risk += 3
  if (a3 === 2) risk += 3
  if (a4 === 2) risk += 3
  if (a5 === 3) risk += 3
  if (a8 === 3) risk += 3
  if (a21 === 3) risk += 3

  // 中度红旗 +2
  if (a1 === 2) risk += 2
  if (a1 === 3) risk += 2
  if (a3 === 3) risk += 2
  if (a6 === 3) risk += 2
  if (a7 === 3) risk += 2

  // 轻度风险 +1
  if (a6 === 2) risk += 1
  if (a7 === 2) risk += 1
  if (a8 === 2) risk += 1

  // 组合封禁
  if ((a2 === 3) && (a21 === 3)) hardBlock = true
  if ((a1 >= 2) && (a3 === 2)) hardBlock = true

  if (hardBlock || risk >= 6) return 'blocked'
  if (risk >= 3) return 'restricted'
  return 'normal'
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
        // 计算真实安全等级（需要问卷答案，未完成问卷的显示为 null/正常）
        safety_level: row.survey_completed ? calcUserSafety(row) : null,
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
        // 用问卷答案计算真实安全等级
        safetyLevel = calcUserSafety(sRow)
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
