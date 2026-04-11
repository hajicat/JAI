// src/app/api/admin/match/route.ts
// 管理员匹配操作入口（POST）
//
// 支持两种模式：
//   - 自动匹配：直接 POST（不带 userA/userB）→ 调用 executeAutoMatch()
//   - 手动指定：POST { userA, userB, weekKey? } → 调用 handleManualMatch()
//
// 改造说明：原文件 639 行（含所有算法函数），
//          算法已提取到 src/lib/match-engine.ts，本文件仅保留 API 入口逻辑。

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { getWeekKey, executeAutoMatch, handleManualMatch } from '@/lib/match-engine'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
  try {
    // ── 身份验证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))

    // ── 模式一：手动指定匹配 ──
    if (body.userA && body.userB) {
      const result = await handleManualMatch(body)
      const status = result.status || (result.success ? 200 : 500)
      return NextResponse.json(result, { status })
    }

    // ── 模式二：自动批量匹配 ──
    const result = await executeAutoMatch()

    if (!result.success) {
      return NextResponse.json(
        { error: '参与人数不足', count: result.totalEligible },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      weekKey: result.weekKey,
      matchedPairs: result.matchedPairs,
      unmatchedUsers: result.unmatchedUsers,
      totalEligible: result.totalEligible,
      safePoolSize: result.safePoolSize,
    })
  } catch (error: any) {
    console.error('[admin/match]', error?.message || error)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
