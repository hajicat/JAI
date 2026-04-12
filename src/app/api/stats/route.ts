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

    // ── 合并统计查询（3 次 DB 往返 → 1 次）──
    const result = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = 0) as totalUsers,
        (SELECT COUNT(*) FROM users WHERE survey_completed = 1 AND is_admin = 0) as completedSurvey,
        (SELECT COUNT(*) FROM matches) as totalMatches
    `)
    const row = result.rows[0] as any

    return NextResponse.json({
      totalUsers: Number(row.totalUsers),
      completedSurvey: Number(row.completedSurvey),
      totalMatches: Number(row.totalMatches),
    })
  } catch (error: any) {
    console.error('[stats]', error?.message || error)
    return NextResponse.json({ totalUsers: 0, completedSurvey: 0, totalMatches: 0 })
  }
}
