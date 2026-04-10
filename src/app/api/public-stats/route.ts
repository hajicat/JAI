import { NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'

export const runtime = 'edge';

/**
 * Public stats endpoint - no auth required.
 * Used by the homepage to display "X 位吉动人完成测试"
 */
export async function GET() {
  try {
    const db = getDb()
    await initDb()

    const totalResult = await db.execute('SELECT COUNT(*) as count FROM users WHERE is_admin = 0')
    const surveyResult = await db.execute('SELECT COUNT(*) as count FROM users WHERE survey_completed = 1 AND is_admin = 0')
    const matchResult = await db.execute('SELECT COUNT(*) as count FROM matches')

    return NextResponse.json({
      totalUsers: Number(totalResult.rows[0].count),
      completedSurvey: Number(surveyResult.rows[0].count),
      totalMatches: Number(matchResult.rows[0].count),
    })
  } catch (error: any) {
    console.error('[public-stats]', error?.message || error)
    return NextResponse.json({ totalUsers: 0, completedSurvey: 0, totalMatches: 0 })
  }
}
