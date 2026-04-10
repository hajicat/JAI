import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

function getWeekKey(): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const diff = now.getTime() - start.getTime()
  const weekNum = Math.ceil(diff / (7 * 24 * 60 * 60 * 1000))
  return now.getFullYear() + '-W' + String(weekNum).padStart(2, '0')
}

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
    const decoded = await verifyToken(token)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const weekKey = getWeekKey()
    const uid = decoded.id

    const sql = 'SELECT m.*, ' +
      'CASE WHEN m.user_a = ? THEN u2.nickname ELSE u1.nickname END as partner_nickname, ' +
      'CASE WHEN m.user_a = ? THEN u2.id ELSE u1.id END as partner_id, ' +
      'CASE WHEN m.user_a = ? THEN m.a_revealed ELSE m.b_revealed END as i_revealed, ' +
      'CASE WHEN m.user_a = ? THEN m.b_revealed ELSE m.a_revealed END as partner_revealed, ' +
      'CASE WHEN m.user_a = ? THEN u2.conflict_type ELSE u1.conflict_type END as partner_conflict_type ' +
      'FROM matches m ' +
      'JOIN users u1 ON m.user_a = u1.id ' +
      'JOIN users u2 ON m.user_b = u2.id ' +
      'WHERE (m.user_a = ? OR m.user_b = ?) AND m.week_key = ?'

    const matchResult = await db.execute({
      sql: sql,
      args: [uid, uid, uid, uid, uid, uid, uid, weekKey],
    })

    if (matchResult.rows.length === 0) {
      return NextResponse.json({ match: null, message: '本周匹配尚未完成，请等待周日匹配' })
    }

    const match = matchResult.rows[0] as any
    let partnerContact = null

    if (match.i_revealed && match.partner_revealed) {
      const partnerResult = await db.execute({
        sql: 'SELECT contact_info, contact_type FROM users WHERE id = ?',
        args: [match.partner_id],
      })
      const partner = partnerResult.rows[0] as any
      if (partner && partner.contact_info) {
        try {
          partnerContact = {
            type: partner.contact_type,
            info: await decrypt(String(partner.contact_info)),
          }
        } catch {
          partnerContact = {
            type: partner.contact_type,
            info: '[解密失败]',
            decryptError: true,
          }
        }
      } else {
        partnerContact = { type: null, info: null, empty: true }
      }
    }

    // 检查当前用户是否填写了联系方式
    let selfHasContact = false
    const selfResult = await db.execute({
      sql: 'SELECT contact_info FROM users WHERE id = ?',
      args: [uid],
    })
    const selfRow = selfResult.rows[0] as any
    if (selfRow && selfRow.contact_info) selfHasContact = true

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
      },
    })
  } catch (error: any) {
    console.error('[match GET]', error && error.message ? error.message : error)
    return NextResponse.json({ error: '获取匹配失败' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })
    const decoded = await verifyToken(token)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = checkRateLimit(ip, API_LIMITER, 'match-reveal')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const matchId = body.matchId
    const id = Number(matchId)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: '无效的匹配ID' }, { status: 400 })
    }

    const db = getDb()
    const matchResult = await db.execute({
      sql: 'SELECT * FROM matches WHERE id = ? AND (user_a = ? OR user_b = ?)',
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
  } catch (error: any) {
    console.error('[match POST]', error && error.message ? error.message : error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
