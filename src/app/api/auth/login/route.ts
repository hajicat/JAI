import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyPassword, createToken } from '@/lib/auth'
import { validateEmail, sanitizeString } from '@/lib/validation'
import { checkRateLimit, LOGIN_LIMITER } from '@/lib/rate-limit'
import { getClientIp, setCsrfCookie, getCookieName, validateCsrfToken } from '@/lib/csrf'

export const runtime = 'edge';

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 30 * 60 * 1000 // 30 minutes

export async function POST(req: NextRequest) {
  try {
    // CSRF protection
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // Rate limiting by IP
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, LOGIN_LIMITER, 'login')
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: '登录尝试过于频繁，请15分钟后再试' },
        { status: 429, headers: { 'Retry-After': String(rateResult.retryAfter) } }
      )
    }

    const body = await req.json()
    const email = sanitizeString(body.email || '', 254).toLowerCase()
    const password = body.password || ''

    // Validate email format
    const emailCheck = validateEmail(email)
    if (!emailCheck.valid) {
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 })
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 })
    }

    const db = getDb()
    await initDb()

    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email],
    })

    const user = result.rows[0] as any

    // Use constant-time approach: always hash even if user doesn't exist
    // to prevent timing-based user enumeration
    if (!user) {
      // Dummy hash + simulated lock-check delay to match real user path
      // 使用 SHA-256 循环（~10-50ms），避免 PBKDF2×5000 触发 CF CPU 上限(502)
      const dummyInput = new TextEncoder().encode(password + ':dummy_delay')
      let hash = new Uint8Array(dummyInput)
      for (let i = 0; i < 500; i++) {
        const buf = await crypto.subtle.digest('SHA-256', hash)
        hash = new Uint8Array(buf)
      }
      // 模拟数据库查询锁定状态的额外延迟（与第69行真实查询对齐）
      await new Promise(resolve => setTimeout(resolve, Math.random() * 5))
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 })
    }

    // Check if account is locked
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until).getTime()
      if (Date.now() < lockExpiry) {
        const remainingMin = Math.ceil((lockExpiry - Date.now()) / 60000)
        return NextResponse.json(
          { error: `账号已锁定，请${remainingMin}分钟后再试` },
          { status: 429 }
        )
      }
      // Lock expired, reset
      await db.execute({
        sql: 'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
        args: [Number(user.id)],
      })
    }

    // Verify password
    if (!await verifyPassword(password, String(user.password_hash))) {
      // Increment failed attempts
      const newAttempts = Number(user.failed_login_attempts || 0) + 1
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
        await db.execute({
          sql: 'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
          args: [newAttempts, lockUntil, Number(user.id)],
        })
        return NextResponse.json(
          { error: '密码错误次数过多，账号已锁定30分钟' },
          { status: 429 }
        )
      }
      await db.execute({
        sql: 'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
        args: [newAttempts, Number(user.id)],
      })
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 })
    }

    // Successful login - reset failed attempts
    await db.execute({
      sql: 'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      args: [Number(user.id)],
    })

    const token = await createToken({
      id: Number(user.id),
      email: String(user.email),
      isAdmin: !!user.is_admin,
    })

    const response = NextResponse.json({
      success: true,
      user: {
        id: Number(user.id),
        nickname: user.nickname,
        isAdmin: !!user.is_admin,
        surveyCompleted: !!user.survey_completed,
      },
    })

    const cookieName = getCookieName('token')
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return setCsrfCookie(response)
  } catch (error: any) {
    console.error('[login]', error?.message || error)
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 })
  }
}
