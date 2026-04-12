// src/app/api/admin/matches/route.ts
// 管理员查看本周所有匹配配对
//
// GET 参数：
//   ?week=2026-W15   指定周（默认当前周）
//   ?page=1          页码（从1开始，默认1）
//   ?limit=10        每页条数（默认10）
//
// 返回：
//   pairs: 当前页配对详情（分页）
//   totalPairs: 总对数（用于分页计算）
//   unmatched: 未匹配用户列表
//   status: 匹配状态 (not_started | running | done)

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { getWeekKey } from '@/lib/week'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  try {
    // ── 身份验证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // ── 查询参数 ──
    const url = new URL(req.url)
    const weekKey = url.searchParams.get('week') || getWeekKey()
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10))
    const offset = (page - 1) * limit

    // ── 查询本周所有配对（分页）──
    const [matchesResult, countResult] = await Promise.all([
      db.execute({
        sql: `SELECT
                m.id, m.score, m.dim_scores, m.reasons, m.week_key,
                m.a_revealed, m.b_revealed, m.created_at,
                u1.id AS user_a_id, u1.nickname AS user_a_name, u1.gender AS user_a_gender,
                u2.id AS user_b_id, u2.nickname AS user_b_name, u2.gender AS user_b_gender
              FROM matches m
              JOIN users u1 ON m.user_a = u1.id
              JOIN users u2 ON m.user_b = u2.id
              WHERE m.week_key = ?
              ORDER BY m.score DESC
              LIMIT ? OFFSET ?`,
        args: [weekKey, limit, offset],
      }),
      db.execute({
        sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?',
        args: [weekKey],
      }),
    ])

    const totalPairs = Number((countResult.rows[0] as any)?.cnt || 0)

    // ── 匹配状态（从 settings 表读取锁）──
    const lockKey = `matching_lock_${weekKey}`
    const lockResult = await db.execute({
      sql: "SELECT value, updated_at FROM settings WHERE key = ?",
      args: [lockKey],
    })
    const lockRow = lockResult.rows[0] as any
    const matchStatus = lockRow ? (lockRow.value as string) : 'not_started'

    // ── 未匹配用户（仅第一页返回，避免重复查询）──
    let unmatchedRows: any[] = []
    let unmatchedCount = 0
    if (page === 1) {
      const unmatchedResult = await db.execute({
        sql: `SELECT u.id, u.nickname, u.gender
              FROM users u
              JOIN survey_responses s ON u.id = s.user_id
              WHERE u.survey_completed = 1 AND u.match_enabled = 1
                AND u.is_admin = 0
                AND u.id NOT IN (
                  SELECT user_a FROM matches WHERE week_key = ?
                  UNION
                  SELECT user_b FROM matches WHERE week_key = ?
                )`,
        args: [weekKey, weekKey],
      })
      unmatchedRows = unmatchedResult.rows
      unmatchedCount = unmatchedRows.length
    }

    // ── 组装响应 ──
    const pairs = matchesResult.rows.map((r: any) => {
      let dimScores = null
      try { dimScores = JSON.parse(String(r.dim_scores || 'null')) } catch {}
      let reasons: string[] = []
      try { reasons = JSON.parse(String(r.reasons || '[]')) } catch {}

      return {
        id: Number(r.id),
        userA: { id: Number(r.user_a_id), name: r.user_a_name, gender: r.user_a_gender },
        userB: { id: Number(r.user_b_id), name: r.user_b_name, gender: r.user_b_gender },
        score: Number(r.score),
        dimScores,
        reasons,
        aRevealed: !!r.a_revealed,
        bRevealed: !!r.b_revealed,
        createdAt: r.created_at,
      }
    })

    return NextResponse.json({
      weekKey,
      status: matchStatus,
      statusTime: lockRow?.updated_at || null,
      pairs,
      page,
      limit,
      totalPairs,
      totalPages: Math.ceil(totalPairs / limit),
      unmatched: unmatchedRows.map((r: any) => ({
        id: Number(r.id),
        name: r.nickname,
        gender: r.gender,
      })),
      unmatchedCount,
    })
  } catch (error: any) {
    console.error('[admin/matches GET]', error?.message || error)
    return NextResponse.json({ error: '获取匹配列表失败' }, { status: 500 })
  }
}
