import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken, verifyTokenSafe, verifyPassword, hashPassword } from '@/lib/auth'
import { validatePassword, sanitizeString } from '@/lib/validation'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyTokenSafe(token, getDb())
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // Rate limit
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'change-pw')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const currentPassword = body.currentPassword || ''
    const newPassword = body.newPassword || ''

    if (!currentPassword) {
      return NextResponse.json({ error: '请输入当前密码' }, { status: 400 })
    }

    const newPwCheck = validatePassword(newPassword)
    if (!newPwCheck.valid) return NextResponse.json({ error: newPwCheck.error }, { status: 400 })

    const db = getDb()
    await initDb()

    // Get current password hash
    const result = await db.execute({
      sql: 'SELECT password_hash FROM users WHERE id = ?',
      args: [decoded.id],
    })

    const user = result.rows[0] as any
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    if (!await verifyPassword(currentPassword, String(user.password_hash))) {
      return NextResponse.json({ error: '当前密码错误' }, { status: 400 })
    }

    // Update password + clear failed login state + invalidate old tokens
    const newHash = await hashPassword(newPassword)
    const changedAt = new Date().toISOString()
    await db.execute({
      sql: 'UPDATE users SET password_hash = ?, password_changed_at = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      args: [newHash, changedAt, decoded.id],
    })

    return NextResponse.json({ success: true, message: '密码修改成功' })
  } catch (error: any) {
    console.error('[change-password]', error?.message || error)
    return NextResponse.json({ error: '修改密码失败' }, { status: 500 })
  }
}
