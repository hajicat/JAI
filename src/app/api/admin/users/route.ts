import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken, hashPassword } from '@/lib/auth'
import { validatePassword } from '@/lib/validation'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const db = getDb()
    const result = await db.execute(`
      SELECT u.id, u.nickname, u.survey_completed, u.created_at,
        u.gender, u.preferred_gender, u.conflict_type, u.match_enabled,
        u2.nickname as invited_by_name,
        (SELECT COUNT(*) FROM invite_codes WHERE created_by = u.id AND current_uses < max_uses) as remaining_codes
      FROM users u
      LEFT JOIN users u2 ON u.invited_by = u2.id
      WHERE u.is_admin = 0
      ORDER BY u.created_at DESC
    `)

    return NextResponse.json({ users: result.rows })
  } catch (error: any) {
    console.error('[admin/users GET]', error?.message || error)
    return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = checkRateLimit(ip, API_LIMITER, 'admin-users')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const action = body.action

    if (action === 'reset-password') {
      const userId = Number(body.userId)
      const newPassword = body.newPassword || ''

      if (!Number.isInteger(userId) || userId <= 0) {
        return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
      }

      const pwCheck = validatePassword(newPassword)
      if (!pwCheck.valid) return NextResponse.json({ error: pwCheck.error }, { status: 400 })

      const db = getDb()

      // Verify target user exists and is not admin
      const userResult = await db.execute({
        sql: 'SELECT id, is_admin FROM users WHERE id = ?',
        args: [userId],
      })
      const targetUser = userResult.rows[0] as any
      if (!targetUser) return NextResponse.json({ error: '用户不存在' }, { status: 404 })
      if (targetUser.is_admin) return NextResponse.json({ error: '不能重置管理员密码' }, { status: 403 })

      const newHash = await hashPassword(newPassword)
      await db.execute({
        sql: 'UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
        args: [newHash, userId],
      })

      return NextResponse.json({ success: true, message: '密码已重置' })
    }

    if (action === 'disable-invite-code') {
      const codeId = Number(body.codeId)
      if (!Number.isInteger(codeId) || codeId <= 0) {
        return NextResponse.json({ error: '无效的邀请码ID' }, { status: 400 })
      }

      const db = getDb()
      await db.execute({
        sql: 'UPDATE invite_codes SET max_uses = 0 WHERE id = ?',
        args: [codeId],
      })

      return NextResponse.json({ success: true, message: '邀请码已禁用' })
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  } catch (error: any) {
    console.error('[admin/users POST]', error?.message || error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
