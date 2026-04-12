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
import { getWeekKey, isMatchingWindow, executeAutoMatchSafe } from '@/lib/match-engine'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge'

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

    // ── 执行带锁的自动匹配（使用 match-engine 导出的统一版本）──
    const result = await executeAutoMatchSafe(db)

    // 记录谁触发了匹配（仅日志用途）
    console.log(`[match/auto] triggered by uid=${decoded.id}, result=${result.status}`)

    return NextResponse.json(result)

  } catch (error: any) {
    console.error('[match/auto]', error?.message || error)
    return NextResponse.json({ error: '匹配触发失败' }, { status: 500 })
  }
}
