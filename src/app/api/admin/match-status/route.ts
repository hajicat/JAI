// src/app/api/admin/match-status/route.ts
// 轻量接口：返回本周是否已执行过自动匹配
// 管理后台打开「执行匹配」tab 时调用，用于展示用户端自动触发的结果

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName, validateCsrfToken } from '@/lib/csrf'
import { getWeekKey } from '@/lib/week'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  try {
    // 从 cookie 取 token（GET 请求无 body）—— 使用 NextRequest 标准 cookie API
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value || ''

    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded || !decoded.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const weekKey = getWeekKey()

    // 查询本周 matches 表中的记录数 + settings 锁状态
    const [matchesResult, lockResult] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?`,
        args: [weekKey],
      }),
      db.execute({
        sql: `SELECT value FROM settings WHERE key = ?`,
        args: [`matching_lock_${weekKey}`],
      }),
    ])

    const matchedPairs = Number((matchesResult.rows[0] as any)?.cnt || 0)
    const lockValue = (lockResult.rows[0] as any)?.value

    // 查询总参与人数（已完成问卷+开启匹配）
    const eligibleResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM users WHERE survey_completed = 1 AND match_enabled = 1`,
      args: [],
    })
    const totalEligible = Number((eligibleResult.rows[0] as any)?.cnt || 0)

    return NextResponse.json({
      matched: lockValue === 'done' || matchedPairs > 0,
      lockStatus: lockValue || null,
      weekKey,
      matchedPairs,
      totalEligible,
      unmatchedUsers: Math.max(0, totalEligible - (matchedPairs * 2)),
    })
  } catch (error) {
    console.error('[admin/match-status]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
