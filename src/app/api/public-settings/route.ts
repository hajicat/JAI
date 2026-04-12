import { NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'

export const runtime = 'edge';

export async function GET() {
  try {
    const db = getDb()
    await initDb()
    let gpsRequired = true
    try {
      const row = await db.execute("SELECT value FROM settings WHERE key = 'gpsRequired'")
      if (row.rows.length > 0) {
        gpsRequired = row.rows[0].value !== '0' && row.rows[0].value !== 'false'
      }
    } catch {
      /* 表不存在则默认开启 */
    }
    
    return NextResponse.json({ gpsRequired }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    })
  } catch {
    return NextResponse.json({ gpsRequired: true })
  }
}
