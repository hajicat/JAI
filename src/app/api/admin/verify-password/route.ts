import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken, hashPassword } from '@/lib/auth'
import { getCookieName } from '@/lib/csrf'

export const runtime = 'edge'

/**
 * POST /api/admin/verify-password
 * Body: { password: string }
 *
 * 验证管理员当前密码是否正确，用于查看用户详情等敏感操作前的二次验证
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
    if (!password) return NextResponse.json({ valid: false }, { status: 400 })

    // 查询用户当前密码哈希
    const db = getDb()
    await initDb()

    const result = await db.execute({
      sql: 'SELECT password_hash FROM users WHERE id = ?',
      args: [decoded.id],
    })
    const row = result.rows[0] as any
    if (!row?.password_hash) return NextResponse.json({ valid: false }, { status: 400 })

    // 用同样的方式哈希输入的密码并比对
    const inputHash = await hashPassword(password)
    if (inputHash === row.password_hash) {
      return NextResponse.json({ valid: true })
    }

    return NextResponse.json({ valid: false })
  } catch (error: any) {
    console.error('[admin verify-password]', error?.message || error)
    return NextResponse.json({ error: '验证失败' }, { status: 500 })
  }
}
