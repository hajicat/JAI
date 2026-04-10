import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

function getWeekKey(): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const diff = now.getTime() - start.getTime()
  const weekNum = Math.ceil(diff / (7 * 24 * 60 * 60 * 1000))
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

interface DimensionScore {
  name: string
  score: number
  compatible: boolean
}

interface MatchResult {
  score: number
  dimScores: DimensionScore[]
  reasons: string[]
}

const CONFLICT_COMPAT: Record<string, Record<string, number>> = {
  dolphin: { dolphin: 60, cat: 40, dog: 80, shark: 50 },
  cat:     { dolphin: 40, cat: 50, dog: 70, shark: 30 },
  dog:     { dolphin: 80, cat: 70, dog: 60, shark: 40 },
  shark:   { dolphin: 50, cat: 30, dog: 40, shark: 30 },
}

const CONFLICT_NAMES: Record<string, string> = {
  dolphin: '🐬 海豚型（回避冲突）',
  cat: '🐱 猫型（焦虑敏感）',
  dog: '🐕 犬型（讨好和解）',
  shark: '🦈 鲨鱼型（强势进攻）',
}

function calculateCompatibility(a: any, b: any): MatchResult {
  let totalScore = 0
  let totalWeight = 0
  const dimScores: DimensionScore[] = []
  const reasons: string[] = []

  const dimensions = [
    { name: '安全联结', questions: ['q1','q2','q3','q4','q5','q6'], weight: 25 },
    { name: '互动模式', questions: ['q7','q8','q9','q10','q11','q12'], weight: 25 },
    { name: '意义系统', questions: ['q13','q14','q15','q16','q17','q18'], weight: 20 },
    { name: '动力发展', questions: ['q19','q20','q21','q22','q23','q24'], weight: 15 },
    { name: '日常系统', questions: ['q25','q26','q27','q28','q29','q30','q31'], weight: 15 },
  ]

  for (const dim of dimensions) {
    let dimScore = 0
    let answered = 0
    for (const q of dim.questions) {
      if (a[q] && b[q]) {
        answered++
        dimScore += a[q] === b[q] ? 100 : 40
      }
    }
    const avg = answered > 0 ? dimScore / answered : 50
    totalScore += avg * dim.weight
    totalWeight += dim.weight
    dimScores.push({ name: dim.name, score: Math.round(avg), compatible: avg >= 65 })
  }

  const conflictA = getConflictType(a.q7)
  const conflictB = getConflictType(b.q7)
  const conflictBonus = CONFLICT_COMPAT[conflictA]?.[conflictB] ?? 50

  const dimAvg = totalWeight > 0 ? totalScore / totalWeight : 0
  const finalScore = dimAvg * 0.85 + conflictBonus * 0.15

  const topDims = dimScores.filter(d => d.compatible).map(d => d.name)
  if (topDims.length > 0) {
    reasons.push(`你们在「${topDims.join('」「')}」维度上很契合`)
  }

  if (conflictBonus >= 70) {
    reasons.push(`冲突风格互补：${CONFLICT_NAMES[conflictA]?.split(' ')[1]} × ${CONFLICT_NAMES[conflictB]?.split(' ')[1]}`)
  }

  const valueQs = ['q13','q14','q15','q16']
  const valueMatches = valueQs.filter(q => a[q] && b[q] && a[q] === b[q]).length
  if (valueMatches >= 2) {
    reasons.push('你们的价值观高度重叠')
  }

  if (finalScore >= 80) {
    reasons.push('你们的整体匹配度非常高！')
  } else if (finalScore >= 60) {
    reasons.push('你们有不错的基础，值得深入了解')
  }

  return {
    score: Math.min(Math.round(finalScore), 99),
    dimScores,
    reasons: reasons.slice(0, 4),
  }
}

function getConflictType(q7: string): string {
  if (!q7) return 'unknown'
  if (q7.includes('海豚')) return 'dolphin'
  if (q7.includes('猫')) return 'cat'
  if (q7.includes('犬')) return 'dog'
  if (q7.includes('鲨鱼')) return 'shark'
  return 'unknown'
}

function genderCompatible(userA: any, userB: any): boolean {
  const aGender = userA.gender
  const bGender = userB.gender
  const aPref = userA.preferred_gender
  const bPref = userB.preferred_gender

  const aWantsB = aPref === 'all' || aPref === bGender
  const bWantsA = bPref === 'all' || bPref === aGender

  return aWantsB && bWantsA
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const db = getDb()
    const weekKey = getWeekKey()

    const usersResult = await db.execute({
      sql: `SELECT u.id, u.gender, u.preferred_gender, u.conflict_type,
                   s.q1, s.q2, s.q3, s.q4, s.q5, s.q6, s.q7, s.q8, s.q9, s.q10,
                   s.q11, s.q12, s.q13, s.q14, s.q15, s.q16, s.q17, s.q18, s.q19, s.q20,
                   s.q21, s.q22, s.q23, s.q24, s.q25, s.q26, s.q27, s.q28, s.q29, s.q30, s.q31
            FROM users u
            JOIN survey_responses s ON u.id = s.user_id
            WHERE u.survey_completed = 1 AND u.match_enabled = 1
              AND u.id NOT IN (
                SELECT user_a FROM matches WHERE week_key = ?
                UNION
                SELECT user_b FROM matches WHERE week_key = ?
              )`,
      args: [weekKey, weekKey],
    })

    const users = usersResult.rows as any[]

    if (users.length < 2) {
      return NextResponse.json({ error: '参与人数不足，至少需要2人', count: users.length })
    }

    const matches: any[] = []
    const matched = new Set<number>()
    const shuffled = [...users].sort(() => Math.random() - 0.5)

    for (let i = 0; i < shuffled.length; i++) {
      if (matched.has(Number(shuffled[i].id))) continue

      let bestMatch: any = null
      let bestScore = 0
      let bestResult: MatchResult | null = null

      for (let j = i + 1; j < shuffled.length; j++) {
        if (matched.has(Number(shuffled[j].id))) continue

        if (!genderCompatible(shuffled[i], shuffled[j])) continue

        const result = calculateCompatibility(shuffled[i], shuffled[j])
        if (result.score > bestScore) {
          bestScore = result.score
          bestMatch = shuffled[j]
          bestResult = result
        }
      }

      if (bestMatch && bestResult && bestScore >= 50) {
        await db.execute({
          sql: `INSERT INTO matches (user_a, user_b, score, dim_scores, reasons, week_key)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            Number(shuffled[i].id),
            Number(bestMatch.id),
            bestScore,
            JSON.stringify(bestResult.dimScores),
            JSON.stringify(bestResult.reasons),
            weekKey,
          ],
        })
        matched.add(Number(shuffled[i].id))
        matched.add(Number(bestMatch.id))
        matches.push({
          userA: shuffled[i].id,
          userB: bestMatch.id,
          score: bestScore,
          dimScores: bestResult.dimScores,
          reasons: bestResult.reasons,
        })
      }
    }

    return NextResponse.json({
      success: true,
      weekKey,
      matchedPairs: matches.length,
      unmatchedUsers: shuffled.length - matched.size,
      totalEligible: users.length,
    })
  } catch (error: any) {
    console.error('[admin/match]', error?.message || error)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
