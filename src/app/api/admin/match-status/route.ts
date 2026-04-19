// src/app/api/admin/match-status/route.ts
// 轻量接口：返回本周是否已执行过自动匹配
// 管理后台打开「执行匹配」tab 时调用，用于展示用户端自动触发的结果

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName, validateCsrfToken } from '@/lib/csrf'
import { getWeekKey } from '@/lib/week'

export const runtime = 'edge'

// 将数据库 UTC 时间字符串转为北京时间（UTC+8）格式化显示
function formatBeijingTime(utcStr: string | null | undefined): string {
  if (!utcStr) return '-'
  try {
    const d = new Date(utcStr + (utcStr.endsWith('Z') ? '' : 'Z'))
    if (isNaN(d.getTime())) return String(utcStr)
    const pad = (n: number) => String(n).padStart(2, '0')
    const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000)
    return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`
  } catch { return String(utcStr) }
}

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
    const triggerKey = `auto_match_trigger_${weekKey}`

    // 查询本周 matches 表中的记录数 + settings 锁状态 + 自动触发记录
    const [matchesResult, lockResult, triggerResult] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?`,
        args: [weekKey],
      }),
      db.execute({
        sql: `SELECT value FROM settings WHERE key = ?`,
        args: [`matching_lock_${weekKey}`],
      }),
      db.execute({
        sql: `SELECT value, updated_at FROM settings WHERE key = ?`,
        args: [triggerKey],
      }),
    ])

    const matchedPairs = Number((matchesResult.rows[0] as any)?.cnt || 0)
    const lockValue = (lockResult.rows[0] as any)?.value

    // 解析自动匹配触发信息
    let autoTriggerInfo: any = null
    const triggerRow = triggerResult.rows[0] as any
    if (triggerRow?.value) {
      try {
        autoTriggerInfo = JSON.parse(triggerRow.value)
        autoTriggerInfo.triggeredAtFormatted = formatBeijingTime(triggerRow.updated_at)
      } catch { /* ignore */ }
    } else if (lockValue === 'done' && matchedPairs > 0) {
      // 锁已完成且有匹配数据，但缺少触发记录（可能是功能上线前触发的匹配）
      // 从 matches 表 + 锁的时间 补算真实数据，让管理员看到有意义的信息
      const lockRow = lockResult.rows[0] as any
      // 尝试查最早一条匹配记录的时间作为触发时间参考
      const earliestMatch = await db.execute({
        sql: `SELECT MIN(created_at) as earliest FROM matches WHERE week_key = ?`,
        args: [weekKey],
      })
      const refTime = ((earliestMatch.rows[0] as any)?.earliest) ||
                       (lockRow?.updated_at) || null

      // 查参与匹配的用户数（去重：user_a + user_b 的并集）
      const participantsResult = await db.execute({
        sql: `SELECT COUNT(DISTINCT u) AS cnt FROM (
                SELECT user_a AS u FROM matches WHERE week_key = ?
                UNION SELECT user_b AS u FROM matches WHERE week_key = ?
              )`,
        args: [weekKey, weekKey],
      })
      const participantsCount = Number((participantsResult.rows[0] as any)?.cnt || 0)

      autoTriggerInfo = {
        triggeredBy: null,  // 未知（功能上线前无记录）
        triggeredAt: refTime,
        triggeredAtFormatted: formatBeijingTime(refTime),
        status: 'done',
        matchedPairs,
        totalEligible: participantsCount,
        unmatchedUsers: Math.max(0, participantsCount - (matchedPairs * 2)),
        inferred: true,  // 标记为补算数据，前端可据此显示提示
      }
    }

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
      autoTrigger: autoTriggerInfo,
    })
  } catch (error) {
    console.error('[admin/match-status]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
