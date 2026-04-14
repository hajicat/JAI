import { NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { setCsrfCookie } from '@/lib/csrf'

export const runtime = 'edge';

export async function GET() {
  try {
    const db = getDb()
    await initDb()
    let gpsRequired = true
    let inviteRequired = true
    try {
      const row = await db.execute("SELECT key, value FROM settings WHERE key IN ('gpsRequired', 'inviteRequired')")
      for (const r of row.rows as any[]) {
        if (r.key === 'gpsRequired') gpsRequired = r.value !== '0' && r.value !== 'false'
        if (r.key === 'inviteRequired') inviteRequired = r.value !== '0' && r.value !== 'false'
      }
    } catch {
      /* 表不存在则默认开启 */
    }
    
    const response = NextResponse.json({ gpsRequired, inviteRequired }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    })
    // 确保首次访问者也有 CSRF token
    setCsrfCookie(response)
    return response
  } catch {
    return NextResponse.json({ gpsRequired: true, inviteRequired: true })
  }
}
