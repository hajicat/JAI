// src/app/api/admin/match-recommendations/route.ts
// 管理员推荐匹配：选择一个用户，列出最匹配的候选人（符合该用户的性别要求）
//
// POST { email, limit? } → { recommendations: [...] }
//
// 使用与自动匹配相同的 calculateMatch() 算法，
// 候选池过滤条件：已完成问卷 + 已启用匹配 + 非blocked + 双向性别兼容

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import {
  calculateMatch,
  calcSafety,
  type MatchResult,
} from '@/lib/match-engine'

export const runtime = 'edge'

const DEFAULT_LIMIT = 20

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const email = String(body.email || '').trim()
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), 50)

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: '请输入有效的注册邮箱' }, { status: 400 })
    }

    // ── 根据邮箱查找用户 ──
    const userLookup = await db.execute({
      sql: `SELECT id FROM users WHERE email = ? LIMIT 1`,
      args: [email],
    })
    if (!userLookup.rows.length) {
      return NextResponse.json({ error: '未找到该邮箱对应的用户' }, { status: 404 })
    }
    const userId = Number(userLookup.rows[0].id)

    // ── 查询选中用户 ──
    const selectedRes = await db.execute({
      sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender, u.school,
              s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
              s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
              s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
              s.q31,s.q32,s.q33,s.q34,s.q35
       FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`,
      args: [userId],
    })
    const selectedUser = selectedRes.rows[0] as any
    if (!selectedUser) {
      return NextResponse.json({ error: '用户不存在或未完成问卷' }, { status: 404 })
    }

    // ── 查询所有候选用户（与自动匹配候选池一致）──
    const candidatesResult = await db.execute({
      sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.safety_level as manual_safety_level,
              s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
              s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
              s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
              s.q31,s.q32,s.q33,s.q34,s.q35
       FROM users u
       JOIN survey_responses s ON u.id = s.user_id
       WHERE u.survey_completed = 1 AND u.match_enabled = 1 AND u.id != ?
         AND (u.verification_status IS NULL OR u.verification_status = 'verified_student')`,
      args: [userId],
    })

    const candidates = candidatesResult.rows as any[]

    // ── 计算每个候选人的匹配度 ──
    const results: Array<{
      userId: number; nickname: string; gender: string; school: string
      score: number; dimScores: any[]; reasons: string[]
      safetyLevel: string
    }> = []

    for (const cand of candidates) {
      // 性别兼容性：双向都要通过
      const aWantsB = selectedUser.preferred_gender === 'all' || selectedUser.preferred_gender === cand.gender
      const bWantsA = cand.preferred_gender === 'all' || cand.preferred_gender === selectedUser.gender
      if (!aWantsB || !bWantsA) continue

      // 安全过滤：排除 blocked 用户
      if (cand.manual_safety_level === 'blocked') continue
      const safety = calcSafety(cand)
      if (safety.level === 'blocked') continue

      const result: MatchResult = calculateMatch(selectedUser, cand)
      results.push({
        userId: Number(cand.id),
        nickname: cand.nickname,
        gender: cand.gender,
        school: cand.school || '',
        score: result.score,
        dimScores: result.dimScores,
        reasons: result.reasons,
        safetyLevel: result.safetyLevel,
      })
    }

    // 按分数降序排列，取前 N 条
    results.sort((a, b) => b.score - a.score)
    const topResults = results.slice(0, limit)

    return NextResponse.json({
      success: true,
      selectedUser: {
        id: Number(selectedUser.id),
        nickname: selectedUser.nickname,
        gender: selectedUser.gender,
        preferredGender: selectedUser.preferred_gender,
        school: selectedUser.school || '',
      },
      totalCandidates: candidates.length,
      compatibleCount: results.length,
      recommendations: topResults,
    })
  } catch (error) {
    console.error('[admin/match-recommendations]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取推荐列表失败' }, { status: 500 })
  }
}
