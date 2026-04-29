// src/app/api/admin/match-preview/route.ts
// 管理员预览两个用户的匹配度（只算分，不写库）
//
// POST { userA, userB } → { score, dimScores, reasons, safetyLevel }
//
// 与 handleManualMatch 的区别：不检查已有匹配、不写入 matches 表

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { calculateMatch } from '@/lib/match-engine'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
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

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const userAId = Number(body.userA)
    const userBId = Number(body.userB)

    if (!Number.isInteger(userAId) || !Number.isInteger(userBId) || userAId <= 0 || userBId <= 0) {
      return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
    }
    if (userAId === userBId) {
      return NextResponse.json({ error: '不能选择同一个用户' }, { status: 400 })
    }

    // ── 查询两个用户的问卷数据 ──
    const [userARes, userBRes] = await Promise.all([
      db.execute({
        sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                s.q31,s.q32,s.q33,s.q34,s.q35
         FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`,
        args: [userAId],
      }),
      db.execute({
        sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                s.q31,s.q32,s.q33,s.q34,s.q35
         FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`,
        args: [userBId],
      }),
    ])

    const userA = userARes.rows[0] as any
    const userB = userBRes.rows[0] as any
    if (!userA || !userB) {
      return NextResponse.json(
        { error: `用户不存在 — A: ${!!userA}, B: ${!!userB}` },
        { status: 404 },
      )
    }

    // ── 计算匹配度（纯计算，不写库）──
    const result = calculateMatch(userA, userB)

    return NextResponse.json({
      success: true,
      preview: {
        userA: { id: userAId, name: userA.nickname },
        userB: { id: userBId, name: userB.nickname },
        score: result.score,
        dimScores: result.dimScores,
        reasons: result.reasons,
        safetyLevel: result.safetyLevel,
      },
    })
  } catch (error) {
    console.error('[admin/match-preview]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '预览匹配度失败' }, { status: 500 })
  }
}
