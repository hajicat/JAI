// src/app/api/match/auto/route.ts
// 用户前端触发的自动匹配端点
//
// 设计思路：
//   Cloudflare Pages 免费版不支持 Cron Worker，
//   所以用"首个访客触发"模式——
//   周日 12:00（北京）之后，第一个打开 /match 页面的已完成问卷用户触发匹配。
//   数据库锁防止重复执行。

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getWeekKey, isMatchingWindow } from '@/lib/week'
import { executeAutoMatch } from '@/lib/match-engine'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge'

/** 死锁阈值：锁超过 5 分钟视为异常，允许抢占 */
const LOCK_EXPIRE_MS = 5 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    // ── 身份验证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // ── 限流 ──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'match-auto')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    // ── 时间窗口检查 ──
    if (!isMatchingWindow()) {
      return NextResponse.json({ status: 'not_yet', message: '还未到匹配时间' })
    }

    // ── 执行带锁的自动匹配 ──
    const result = await executeAutoMatchSafe(db)

    // 记录谁触发了匹配（仅日志用途）
    console.log(`[match/auto] triggered by uid=${decoded.id}, result=${result.status}`)

    return NextResponse.json(result)

  } catch (error: any) {
    console.error('[match/auto]', error?.message || error)
    return NextResponse.json({ error: '匹配触发失败' }, { status: 500 })
  }
}

// ── 带数据库锁的安全匹配执行 ──
//
// 状态机：
//   not_started → running → done
//
// 使用 settings 表做分布式锁：
//   key = "matching_lock_{weekKey}"
//   value = "running" | "done"

async function executeAutoMatchSafe(db: ReturnType<typeof getDb>): Promise<{
  status: string
  weekKey?: string
  message?: string
  matchedPairs?: number
  unmatchedUsers?: number
  totalEligible?: number
}> {
  const weekKey = getWeekKey()
  const lockKey = `matching_lock_${weekKey}`

  // 1. 已经完成 → 直接返回
  const doneCheck = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ? AND value = 'done'",
    args: [lockKey],
  })
  if (doneCheck.rows.length > 0) {
    return { status: 'already_done', weekKey }
  }

  // 2. 正在跑 → 检查是否死锁
  const runningCheck = await db.execute({
    sql: "SELECT value, updated_at FROM settings WHERE key = ? AND value = 'running'",
    args: [lockKey],
  })
  if (runningCheck.rows.length > 0) {
    const lockRow = runningCheck.rows[0] as any
    const lockTime = lockRow.updated_at
    if (lockTime) {
      const lockAge = Date.now() - new Date(lockTime).getTime()
      if (lockAge > LOCK_EXPIRE_MS) {
        // 死锁：清除旧锁后继续
        await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
      } else {
        // 正在执行中，让客户端稍后重试
        return { status: 'in_progress', weekKey }
      }
    } else {
      return { status: 'in_progress', weekKey }
    }
  }

  // 3. 抢锁（原子操作：INSERT ... WHERE NOT EXISTS）
  try {
    await db.execute({
      sql: `INSERT INTO settings (key, value, updated_at)
            SELECT ?, 'running', datetime('now')
            WHERE NOT EXISTS (
              SELECT 1 FROM settings WHERE key = ? AND value IN ('running', 'done')
            )`,
      args: [lockKey, lockKey],
    })
  } catch {
    // INSERT 冲突说明别人抢到了
    return { status: 'in_progress', weekKey }
  }

  // 4. 双重检查：确认抢锁成功
  const confirmLock = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [lockKey],
  })
  if ((confirmLock.rows[0] as any)?.value !== 'running') {
    return { status: 'in_progress', weekKey }
  }

  // 5. 执行匹配
  try {
    const result = await executeAutoMatch()

    // 标记完成
    await db.execute({
      sql: "UPDATE settings SET value = 'done', updated_at = datetime('now') WHERE key = ?",
      args: [lockKey],
    })

    return {
      status: 'done',
      weekKey,
      matchedPairs: result.matchedPairs,
      unmatchedUsers: result.unmatchedUsers,
      totalEligible: result.totalEligible,
    }
  } catch (err) {
    // 出错释放锁，下次可以重试
    await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
    throw err
  }
}
