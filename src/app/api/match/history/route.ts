// src/app/api/match/history/route.ts
// 历史匹配记录接口：返回用户所有历史匹配（按周分组）
//
// 安全规则：
//   - 联系方式仅在双方都 revealed 时返回（与 /api/match GET 一致）
//   - 历史周不受 isRevealWindow 限制（已过期的匹配可以查看基本信息）
//   - 当前周的匹配仍受 isRevealWindow 保护
//
// 响应格式：
//   { weeks: [{ weekKey, matches: [...], totalMatches, revealedCount }] }

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { getClientIp, getCookieName } from '@/lib/csrf'
import { isRevealWindow, getWeekKey } from '@/lib/week'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    
    // 使用 verifyTokenSafe（安全验证，带密码变更检查）
    // 如果失败返回 null 而不是抛出异常
    let decoded;
    try {
      decoded = await verifyTokenSafe(token, db);
    } catch (tokenErr: any) {
      return NextResponse.json({ error: '认证失败' }, { status: 401 })
    }
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const uid = decoded.id
    const currentWeekKey = getWeekKey()
    const isAdmin = !!decoded.isAdmin

    // ── 查询用户所有历史匹配记录（按周倒序，最新的在前）──
    const result = await db.execute({
      sql: `
        SELECT m.id, m.week_key, m.score, m.dim_scores, m.reasons, m.created_at,
               m.a_revealed, m.b_revealed,
               CASE WHEN m.user_a = ? THEN u2.nickname ELSE u1.nickname END as partner_nickname,
               CASE WHEN m.user_a = ? THEN u2.gender ELSE u1.gender END as partner_gender,
               CASE WHEN m.user_a = ? THEN u2.conflict_type ELSE u1.conflict_type END as partner_conflict_type,
               CASE WHEN m.user_a = ? THEN u2.contact_info ELSE u1.contact_info END as partner_contact_info,
               CASE WHEN m.user_a = ? THEN u2.contact_type ELSE u1.contact_type END as partner_contact_type,
               CASE WHEN m.user_a = ? THEN m.a_revealed ELSE m.b_revealed END as i_revealed,
               CASE WHEN m.user_a = ? THEN m.b_revealed ELSE m.a_revealed END as partner_revealed
        FROM matches m
        JOIN users u1 ON m.user_a = u1.id
        JOIN users u2 ON m.user_b = u2.id
        WHERE (m.user_a = ? OR m.user_b = ?)
        ORDER BY m.week_key DESC, m.created_at DESC
      `,
      args: [uid, uid, uid, uid, uid, uid, uid, uid, uid],
    })

    const rows = result.rows as any[]

    if (rows.length === 0) {
      return NextResponse.json({ weeks: [], totalWeeks: 0 })
    }

    // ── 按周分组 ──
    const weekMap = new Map<string, any[]>()

    for (const row of rows) {
      const wk = row.week_key
      const iRevealed = !!row.i_revealed
      const partnerRevealed = !!row.partner_revealed
      const bothRevealed = iRevealed && partnerRevealed
      const isCurrentWeek = wk === currentWeekKey

      // 联系方式解密：仅双方都确认时返回
      let contact = null
      if (bothRevealed && row.partner_contact_info) {
        try {
          contact = {
            type: row.partner_contact_type,
            info: await decrypt(String(row.partner_contact_info)),
          }
        } catch {
          contact = { type: row.partner_contact_type, info: '[解密失败]', decryptError: true }
        }
      } else if (bothRevealed && !row.partner_contact_info) {
        contact = { type: null, info: null, empty: true }
      }

      let dimScores = null
      try { dimScores = JSON.parse(String(row.dim_scores || 'null')) } catch { /* ignore */ }

      // 当前周未到揭晓时间 → 非管理员隐藏详细信息
      const hideDetails = isCurrentWeek && !isRevealWindow() && !isAdmin

      const entry = {
        id: Number(row.id),
        partnerNickname: String(row.partner_nickname || '未知'),
        partnerGender: row.partner_gender || null,
        score: Number(row.score),
        dimScores: hideDetails ? null : dimScores,
        reasons: hideDetails ? [] : (JSON.parse(String(row.reasons || '[]'))),
        createdAt: row.created_at,
        iRevealed,
        partnerRevealed,
        bothRevealed,
        contact: bothRevealed ? contact : null,
        hidden: hideDetails,
      }

      if (!weekMap.has(wk)) weekMap.set(wk, [])
      weekMap.get(wk)!.push(entry)
    }

    // ── 构建响应数组（按周倒序）──
    const weeks = Array.from(weekMap.entries()).map(([weekKey, matches]) => {
      const revealedCount = matches.filter(m => m.bothRevealed).length
      const isCurrent = weekKey === currentWeekKey
      return {
        weekKey,
        isCurrent,
        totalMatches: matches.length,
        revealedCount,
        matches,
      }
    })

    return NextResponse.json({
      weeks,
      totalWeeks: weeks.length,
    })
  } catch (error: any) {
    return NextResponse.json({ error: '获取历史匹配失败' }, { status: 500 })
  }
}
