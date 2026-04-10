export const runtime = 'edge'

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { hashPassword, generateInviteCode } from '@/lib/security'

// 临时密码重置/创建接口 - 用完后请删除此文件！
export async function GET() {
  try {
    const db = await getDb()
    // 生成随机密码（兼容 Edge Runtime）
    const array = new Uint8Array(12)
    crypto.getRandomValues(array)
    const randomPwd = Array.from(array, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)

    // 查找管理员
    const result = await db.execute('SELECT id, email FROM users WHERE is_admin = 1 LIMIT 1')

    let email: string
    let adminId: number

    if (result.rows.length === 0) {
      // 管理员不存在 → 创建一个（数据库未初始化的情况）
      const adminCode = generateInviteCode()
      const newPassword = randomPwd
      const pwHash = await hashPassword(newPassword)

      await db.execute({
        sql: `INSERT INTO users (nickname, email, password_hash, invite_code, is_admin, gender, preferred_gender)
              VALUES (?, ?, ?, ?, 1, 'other', 'all')`,
        args: ['管理员', 'admin@jlai.local', pwHash, adminCode],
      })

      const adminResult = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: ['admin@jlai.local'] })
      adminId = Number(adminResult.rows[0].id)
      email = 'admin@jlai.local'

      // 创建10个初始邀请码
      for (let i = 0; i < 10; i++) {
        const code = generateInviteCode()
        await db.execute({
          sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
          args: [code, adminId],
        })
      }

      return NextResponse.json({
        message: '✅ 管理员账号已创建（请立即登录修改密码！）',
        email,
        newPassword,
        inviteCode: adminCode,
        loginUrl: '/login',
        warning: '⚠️ 请用完后删除 /api/reset-admin 文件！',
      })
    }

    // 管理员已存在 → 重置密码
    const newPassword = randomPwd
    const pwHash = await hashPassword(newPassword)
    adminId = result.rows[0].id as number
    email = result.rows[0].email as string

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
    return NextResponse.json({ error: e.message, detail: '数据库连接或操作失败' }, { status: 500 })
  }
}
