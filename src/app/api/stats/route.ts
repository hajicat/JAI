import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    // Auth check - only admins can view stats
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value

    if (!token) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded || !decoded.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

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
    console.error('[stats]', error?.message || error)
    return NextResponse.json({ totalUsers: 0, completedSurvey: 0, totalMatches: 0 })
  }
}
