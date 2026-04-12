import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenSafe } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

// CF Workers 多 isolate 各自独立内存，不使用模块级缓存
// 每次请求直接查询数据库，确保多 isolate 间数据一致

async function loadSettings(db: ReturnType<typeof getDb>) {
  // 先确保表存在
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    )`)
  } catch { /* ignore */ }

  const row = await db.execute("SELECT key, value FROM settings")
  const settings: any = {}
  // 敏感键不应通过 API 暴露（密码哈希等）
  const SENSITIVE_KEYS = ['admin_view_password_hash']
  if (row.rows.length > 0) {
    for (const r of row.rows as any[]) {
      // 跳过敏感键
      if (SENSITIVE_KEYS.includes(r.key)) continue
      settings[r.key] = r.value === '1' || r.value === 'true' ? true :
                       r.value === '0' || r.value === 'false' ? false : r.value
    }
  }
  
  // 默认设置
  if (settings.gpsRequired === undefined) {
    settings.gpsRequired = true
  }
  
  return settings
}

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const settings = await loadSettings(db)
    
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

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json()

    if (typeof body.gpsRequired === 'boolean') {
      await db.execute({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('gpsRequired', ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        args: [body.gpsRequired ? '1' : '0'],
      })
      // 不再使用缓存，重新查询数据库获取最新值
      const settings = await loadSettings(db)
      return NextResponse.json({ success: true, ...settings })
    }

    return NextResponse.json({ error: '无效的设置项' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
