import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken, verifyTokenSafe } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'
import { isRevealWindow, getWeekKey, isMatchingWindow } from '@/lib/week'

export const runtime = 'edge';

const CONFLICT_NAMES: Record<string, string> = {
  dolphin: '🐬 海豚型（回避冲突）',
  cat: '🐱 猫型（焦虑敏感）',
  dog: '🐕 犬型（讨好和解）',
  shark: '🦈 鲨鱼型（强势进攻）',
}

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const weekKey = getWeekKey()
    const uid = decoded.id

    // ── 主查询：匹配数据 + 对方信息 + 自己联系方式 ──
    const sql = 'SELECT m.*, ' +
      'CASE WHEN m.user_a = ? THEN u2.nickname ELSE u1.nickname END as partner_nickname, ' +
      'CASE WHEN m.user_a = ? THEN u2.id ELSE u1.id END as partner_id, ' +
      'CASE WHEN m.user_a = ? THEN m.a_revealed ELSE m.b_revealed END as i_revealed, ' +
      'CASE WHEN m.user_a = ? THEN m.b_revealed ELSE m.a_revealed END as partner_revealed, ' +
      'CASE WHEN m.user_a = ? THEN u2.conflict_type ELSE u1.conflict_type END as partner_conflict_type, ' +
      // 对方联系方式（加密存储）
      'CASE WHEN m.user_a = ? THEN u2.contact_info ELSE u1.contact_info END as partner_contact_info, ' +
      'CASE WHEN m.user_a = ? THEN u2.contact_type ELSE u1.contact_type END as partner_contact_type, ' +
      // 自己是否填了联系方式
      'CASE WHEN m.user_a = ? THEN u1.contact_info ELSE u2.contact_info END as self_contact_info ' +
      'FROM matches m ' +
      'JOIN users u1 ON m.user_a = u1.id ' +
      'JOIN users u2 ON m.user_b = u2.id ' +
      'WHERE (m.user_a = ? OR m.user_b = ?) AND m.week_key = ?'

    let matchResult = await db.execute({
      sql: sql,
      args: [uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, weekKey],
    })

    // ── 可见窗口内回退查询：当前周无匹配时，取最近一周的匹配结果展示 ──
    // 原因：weekKey 在周日12:00(北京)切换，但匹配结果应在可见窗口内持续展示
    if (matchResult.rows.length === 0 && isRevealWindow()) {
      const fallbackSql = 'SELECT m.*, ' +
        'CASE WHEN m.user_a = ? THEN u2.nickname ELSE u1.nickname END as partner_nickname, ' +
        'CASE WHEN m.user_a = ? THEN u2.id ELSE u1.id END as partner_id, ' +
        'CASE WHEN m.user_a = ? THEN m.a_revealed ELSE m.b_revealed END as i_revealed, ' +
        'CASE WHEN m.user_a = ? THEN m.b_revealed ELSE m.a_revealed END as partner_revealed, ' +
        'CASE WHEN m.user_a = ? THEN u2.conflict_type ELSE u1.conflict_type END as partner_conflict_type, ' +
        'CASE WHEN m.user_a = ? THEN u2.contact_info ELSE u1.contact_info END as partner_contact_info, ' +
        'CASE WHEN m.user_a = ? THEN u2.contact_type ELSE u1.contact_type END as partner_contact_type, ' +
        'CASE WHEN m.user_a = ? THEN u1.contact_info ELSE u2.contact_info END as self_contact_info ' +
        'FROM matches m ' +
        'JOIN users u1 ON m.user_a = u1.id ' +
        'JOIN users u2 ON m.user_b = u2.id ' +
        'WHERE (m.user_a = ? OR m.user_b = ?) ' +
        'ORDER BY m.created_at DESC LIMIT 1'

      matchResult = await db.execute({
        sql: fallbackSql,
        args: [uid, uid, uid, uid, uid, uid, uid, uid, uid, uid],
      })
    }

    if (matchResult.rows.length === 0) {
      // ── 三种状态区分：等待中 / 轮空 / 新用户待下周 ──
      //
      // 1. 匹配未完成（或非管理员且未到揭晓时间）→ 等待中
      // 2. 匹配已完成 + 用户已在匹配前做完问卷 → 真正的轮空
      // 3. 匹配已完成 + 用户在匹配后才做问卷 → 新用户，等待下周参与
      //
      // 判断方式：对比 survey.updated_at 和 lock 的 updated_at
      //   survey 更新时间 <= lock 完成时间 → 参与了本轮但没配上
      //   survey 更新时间 > lock 完成时间 → 本轮跑的时候还没做问卷
      //
      // ⚠️ 关键：必须查最近一次已完成的匹配锁，而非仅本周锁。
      //   因为用户可能上周参与了匹配（回退查询也取到了那条记录），
      //   但主查询按 weekKey 过滤找不到。此时若只查本周锁会误判为"等待中"。

      const [lockRes, surveyRes] = await Promise.all([
        db.execute({
          sql: "SELECT key, value, updated_at FROM settings WHERE key LIKE 'matching_lock_%' AND value = ? ORDER BY updated_at DESC LIMIT 1",
          args: ['done'],
        }),
        db.execute({
          sql: "SELECT updated_at FROM survey_responses WHERE user_id = ? LIMIT 1",
          args: [uid],
        }),
      ])
      const lockRow = lockRes.rows[0] as any
      const lockStatus = lockRow?.value
      const lockUpdatedAt = lockRow?.updated_at || ''
      const matchedDone = lockStatus === 'done'
      const surveyRow = surveyRes.rows[0] as any
      const surveyUpdatedAt = surveyRow?.updated_at || ''
      const hasSurvey = !!surveyRow
      const canSeeStatus = isRevealWindow() || !!decoded.isAdmin

      // ── 情况A：匹配未完成 / 未到揭晓时间 → 统一显示等待中 ──
      if (!matchedDone || (!canSeeStatus && matchedDone && !hasSurvey)) {
        return NextResponse.json({ match: null, message: '本周匹配尚未完成，请耐心等待', matchedDone: false })
      }

      // ── 情况B：没做问卷 → 引导去做题 ──
      if (!hasSurvey) {
        return NextResponse.json({ match: null, message: '请先完成问卷才能参与匹配', matchedDone: false })
      }

      // ── 情况C & D：匹配已完成 + 已做问卷 ──
      // 判断用户是否在匹配执行前就已经提交了问卷
      const participatedInThisRound = lockUpdatedAt && surveyUpdatedAt && (surveyUpdatedAt <= lockUpdatedAt)

      if (participatedInThisRound) {
        // 情况C：参与了本轮匹配但没有配上 → 真正的轮空
        return NextResponse.json({
          match: null,
          message: canSeeStatus ? '本周暂未匹配到合适的搭档' : '本周匹配尚未完成，请耐心等待',
          matchedDone: true,
        })
      } else {
        // 情况D：匹配结束后才做的问卷（新注册/后补问卷）→ 不算轮空，等下周
        return NextResponse.json({
          match: null,
          message: '你已完成问卷，系统将在下周日为你匹配',
          matchedDone: false,
        })
      }
    }

    const match = matchResult.rows[0] as any

    // 未到揭晓时间（北京时间周日20:00前）→ 非管理员用户看不到任何匹配信息
    if (!isRevealWindow() && !decoded.isAdmin) {
      return NextResponse.json({ match: null, message: '本周匹配尚未完成，请耐心等待' })
    }

    let partnerContact = null
    let partnerSurvey: any = null

    if (match.i_revealed && match.partner_revealed) {
      // 对方联系方式 — 直接从主查询取，不再单独查
      if (match.partner_contact_info) {
        try {
          partnerContact = {
            type: match.partner_contact_type,
            info: await decrypt(String(match.partner_contact_info)),
          }
        } catch {
          partnerContact = {
            type: match.partner_contact_type,
            info: '[解密失败]',
            decryptError: true,
          }
        }
      } else {
        partnerContact = { type: null, info: null, empty: true }
      }

      // 获取对方的问卷回答（双方确认后可见）— 仍需单独查
      const surveyResult = await db.execute({
        sql: `SELECT s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                      s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                      s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                      s.q31,s.q32,s.q33,s.q34,s.q35
               FROM survey_responses s WHERE s.user_id = ?`,
        args: [match.partner_id],
      })
      partnerSurvey = surveyResult.rows[0] as any || null
    }

    // 自己是否填了联系方式 — 直接从主查询取
    const selfHasContact = !!match.self_contact_info

    let dimScores = null
    try {
      dimScores = JSON.parse(String(match.dim_scores || 'null'))
    } catch (e) { /* ignore */ }

    return NextResponse.json({
      match: {
        id: Number(match.id),
        partnerId: Number(match.partner_id),
        partnerNickname: String(match.partner_nickname),
        score: Number(match.score),
        dimScores: dimScores,
        reasons: JSON.parse(String(match.reasons || '[]')),
        weekKey: String(match.week_key),
        iRevealed: !!match.i_revealed,
        partnerRevealed: !!match.partner_revealed,
        contact: partnerContact,
        selfHasContact,
        partnerSurvey,
      },
    })
  } catch (error) {
    console.error('[match GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取匹配失败' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    // reveal 是敏感操作，用 verifyTokenSafe 校验密码修改时间
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // 揭晓时间检查：非揭晓窗口内不允许标记 revealed
    if (!isRevealWindow() && !decoded.isAdmin) {
      return NextResponse.json({ error: '匹配结果尚未揭晓，请等待周日20:00' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'match-reveal')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const matchId = body.matchId
    const id = Number(matchId)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: '无效的匹配ID' }, { status: 400 })
    }

    const matchResult = await db.execute({
      sql: 'SELECT id, user_a, user_b FROM matches WHERE id = ? AND (user_a = ? OR user_b = ?)',
      args: [id, decoded.id, decoded.id],
    })
    const match = matchResult.rows[0] as any
    if (!match) return NextResponse.json({ error: '匹配不存在或无权操作' }, { status: 404 })

    const userA = Number(match.user_a)
    const userB = Number(match.user_b)

    if (userA === decoded.id) {
      await db.execute({ sql: 'UPDATE matches SET a_revealed = 1 WHERE id = ?', args: [id] })
    } else {
      await db.execute({ sql: 'UPDATE matches SET b_revealed = 1 WHERE id = ?', args: [id] })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[match POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
