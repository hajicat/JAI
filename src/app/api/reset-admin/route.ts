import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { hashPassword } from '@/lib/security'

// 临时密码重置接口 - 用完后请删除此文件！
export async function GET() {
  try {
    const db = await getDb()

    // 查找管理员
    const result = await db.execute('SELECT id, email FROM users WHERE is_admin = 1 LIMIT 1')

    if (result.rows.length === 0) {
      return NextResponse.json({ error: '管理员账号不存在，数据库可能未初始化' }, { status: 404 })
    }

    const crypto = await import('crypto')
    const newPassword = crypto.randomBytes(12).toString('base64url')
    const pwHash = await hashPassword(newPassword)

    const adminId = result.rows[0].id as number
    const email = result.rows[0].email as string

    // 更新密码
    await db.execute({
      sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
      args: [pwHash, adminId],
    })

    return NextResponse.json({
      message: '✅ 管理员密码已重置（请立即登录修改密码！）',
      email,
      newPassword,
      loginUrl: '/login',
      warning: '⚠️ 请用完后删除 /api/reset-admin 文件！',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
