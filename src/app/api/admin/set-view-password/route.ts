import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken, hashPassword } from '@/lib/auth'
import { validatePassword } from '@/lib/validation'
import { getCookieName } from '@/lib/csrf'

export const runtime = 'edge'

/**
 * POST /api/admin/set-view-password
 * Body: { password: string }
 *
 * 设置/修改管理员查看详情的独立二级密码
 * 存储在 settings 表 admin_view_password_hash 键中
 */
export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded) return NextResponse.json({ error: '未登录' }, { status: 401 })
    if (!decoded.isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 })

    // CSRF check
    const csrfToken = req.headers.get('x-csrf-token')
    if (!csrfToken) return NextResponse.json({ error: '缺少CSRF Token' }, { status: 400 })
    const cookieCsrf = req.cookies.get('csrf-token')?.value
    if (csrfToken !== cookieCsrf) {
      return NextResponse.json({ error: 'CSRF验证失败' }, { status: 403 })
    }

    const body = await req.json()
    const password = (body.password || '').trim()

    if (!password) {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 })
    }

    // 校验密码格式
    const pwCheck = validatePassword(password)
    if (!pwCheck.valid) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 })
    }

    const db = getDb()
    await initDb()

    // 哈希并存储
    const hashed = await hashPassword(password)
    const now = new Date().toISOString()

    // UPSERT
    await db.execute({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES ('admin_view_password_hash', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [hashed, now],
    })

    return NextResponse.json({ success: true, message: '二级密码已设置' })
  } catch (error: any) {
    console.error('[admin set-view-password]', error?.message || error)
    return NextResponse.json({ error: '设置失败', success: false }, { status: 500 })
  }
}

/**
 * GET /api/admin/set-view-password
 *
 * 检查是否已设置过二级密码
 */
export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 })

    const db = getDb()
    await initDb()

    const result = await db.execute({
      sql: "SELECT value FROM settings WHERE key = 'admin_view_password_hash'",
      args: [],
    })
    const row = result.rows[0] as any

    return NextResponse.json({
      hasPassword: !!row?.value,
    })
  } catch (error: any) {
    return NextResponse.json({ hasPassword: false }, { status: 500 })
  }
}
