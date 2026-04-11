import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken, hashPassword } from '@/lib/auth'
import { getCookieName } from '@/lib/csrf'

export const runtime = 'edge'

/**
 * POST /api/admin/verify-password
 * Body: { password: string }
 *
 * 验证管理员"查看详情二级密码"（独立于登录密码）
 * 密码存储在 settings 表的 admin_view_password_hash 键中
 */
export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded) return NextResponse.json({ error: '未登录' }, { status: 401 })
    if (!decoded.isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 })

    const body = await req.json()
    const password = (body.password || '').trim()
    if (!password) return NextResponse.json({ valid: false, needSetup: false }, { status: 400 })

    const db = getDb()
    await initDb()

    // 查询独立的查看详情密码哈希
    const result = await db.execute({
      sql: "SELECT value FROM settings WHERE key = 'admin_view_password_hash'",
      args: [],
    })
    const row = result.rows[0] as any

    // 还没设置过二级密码 → 返回提示前端让用户去设置
    if (!row?.value) {
      return NextResponse.json({
        valid: false,
        needSetup: true,
        message: '尚未设置查看详情密码，请先在系统设置中设置',
      })
    }

    // 比对
    const inputHash = await hashPassword(password)
    if (inputHash === row.value) {
      return NextResponse.json({ valid: true })
    }

    return NextResponse.json({ valid: false, needSetup: false, message: '密码错误' })
  } catch (error: any) {
    console.error('[admin verify-password]', error?.message || error)
    return NextResponse.json({ error: '验证失败', valid: false }, { status: 500 })
  }
}
