import { NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'

export const runtime = 'edge';

/**
 * Combined home data endpoint - single API call for homepage.
 * Returns: public stats + user info (if authenticated)
 * This replaces calling /api/public-stats + /api/auth/me separately,
 * cutting cold-start latency in half.
 */
export async function GET(req: Request) {
  try {
    const db = getDb()
    await initDb()

    // ── 合并统计查询（3 次 DB 往返 → 1 次）──
    const statsResult = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = 0) as totalUsers,
        (SELECT COUNT(*) FROM users WHERE survey_completed = 1 AND is_admin = 0) as completedSurvey,
        (SELECT COUNT(*) FROM matches) as totalMatches
    `)

    const statsRow = statsResult.rows[0] as any
    const publicStats = {
      totalUsers: Number(statsRow.totalUsers),
      completedSurvey: Number(statsRow.completedSurvey),
      totalMatches: Number(statsRow.totalMatches),
    }

    // Check if user is authenticated
    let user = null
    const cookieHeader = req.headers.get('cookie') || ''
    const cookieName = process.env.NODE_ENV === 'production' ? '__Host-token' : 'token'
    // 用正则提取，避免 split('=')[1] 截断值中的 = 号（如 JWT payload 含 = 的情况）
    const tokenMatch = new RegExp('(?:^|;\\s*)' + cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)').exec(cookieHeader)
    const token = tokenMatch?.[1] || null

    if (token) {
      try {
        const decoded = await verifyToken(token)
        if (decoded) {
          // Only fetch essential fields, no invite codes (keep it light)
          const userResult = await db.execute({
            sql: `SELECT id, nickname, email, is_admin, survey_completed
                   FROM users WHERE id = ?`,
            args: [decoded.id],
          })
          const u = userResult.rows[0] as any
          if (u) {
            user = {
              id: Number(u.id),
              nickname: u.nickname,
              isAdmin: !!u.is_admin,
              surveyCompleted: !!u.survey_completed,
            }
          }
        }
      } catch {
        // Invalid token — treat as not logged in
      }
    }

    const response = NextResponse.json({
      ...publicStats,
      user,
    }, {
      headers: {
        // 有用户私有数据时必须用 private，防止 CDN 缓存导致数据泄露
        ...(user ? { 'Cache-Control': 'private, no-store' } : { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' }),
        'Vary': 'Cookie',
      },
    })

    // 刷新非 httpOnly 状态 cookie（前端同步读取用）
    if (user) {
      response.cookies.set('logged_in', 'true', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 })
      response.cookies.set('survey_status', user.surveyCompleted ? 'done' : 'pending', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 })
    } else {
      // token 无效时清除状态 cookie
      response.cookies.set('logged_in', '', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
      response.cookies.set('survey_status', '', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
    }

    return response
  } catch (error: any) {
    console.error('[home-data]', error?.message || error)
    return NextResponse.json({
      totalUsers: 0,
      completedSurvey: 0,
      totalMatches: 0,
      user: null,
    }, {
      headers: {
        // Cache error response briefly to avoid thundering herd
        'Cache-Control': 'public, s-maxage=5',
      },
    })
  }
}
