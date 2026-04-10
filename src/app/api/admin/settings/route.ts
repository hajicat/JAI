import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { getDb, initDb } from '@/lib/db'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

// 简单内存存储（生产环境可改用 KV 或数据库）
let settingsCache: Record<string, any> | null = null

async function ensureSettings(db: ReturnType<typeof getDb>) {
  if (settingsCache) return settingsCache
  
  // 尝试从 settings 表读取
  try {
    // 先确保表存在
    await db.execute(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    )`)
    
    const row = await db.execute("SELECT key, value FROM settings")
    if (row.rows.length > 0) {
      settingsCache = {}
      for (const r of row.rows as any[]) {
        settingsCache[r.key] = r.value === '1' || r.value === 'true' ? true :
                             r.value === '0' || r.value === 'false' ? false : r.value
      }
    }
  } catch {
    /* ignore - use defaults */
  }
  
  // 默认设置
  if (!settingsCache) {
    settingsCache = { gpsRequired: true }
  }
  if (settingsCache.gpsRequired === undefined) {
    settingsCache.gpsRequired = true
  }
  
  return settingsCache
}

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })
    
    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const db = getDb()
    const settings = await ensureSettings(db)
    
    return NextResponse.json(settings)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })
    
    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json()
    const db = getDb()

    if (typeof body.gpsRequired === 'boolean') {
      await db.execute({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('gpsRequired', ?, datetime('now', 'localtime'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')`,
        args: [body.gpsRequired ? '1' : '0'],
      })
      // 清除缓存
      settingsCache = null
      const settings = await ensureSettings(db)
      return NextResponse.json({ success: true, ...settings })
    }

    return NextResponse.json({ error: '无效的设置项' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// 导出供其他模块使用
export async function isGpsRequired(): Promise<boolean> {
  const db = getDb()
  const settings = await ensureSettings(db)
  return settings.gpsRequired !== false
}
