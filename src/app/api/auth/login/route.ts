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

    // 防止超长密码消耗 CPU/内存
    if (password.length > 128) {
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 })
    }

    const db = getDb()
    await initDb()

    const result = await db.execute({
      sql: 'SELECT id, email, password_hash, is_admin, nickname, survey_completed, failed_login_attempts, locked_until FROM users WHERE email = ?',
      args: [email],
    })

    const user = result.rows[0] as any

    // Use constant-time approach: always hash even if user doesn't exist
    // to prevent timing-based user enumeration
    if (!user) {
      // Dummy PBKDF2 hash — 与真实路径使用相同算法和迭代次数（5000），防止时序攻击
      // 真实路径: PBKDF2-SHA512×5000 (~20-30ms) + DB 查询
      // Dummy 路径: PBKDF2-SHA512×5000 (~20-30ms)，耗时基本一致
      const dummySalt = new Uint8Array(32)
      crypto.getRandomValues(dummySalt)
      try {
        const keyMaterial = await crypto.subtle.importKey(
          'raw', new TextEncoder().encode(`_dummy_:${password}`), { name: 'PBKDF2' }, false, ['deriveBits']
        )
        await crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: dummySalt, iterations: 5000, hash: 'SHA-512' },
          keyMaterial,
          64 * 8
        )
      } catch { /* ignore */ }
      // 微量随机延迟覆盖 DB 查询锁定状态的微小时间差
      await new Promise(resolve => setTimeout(resolve, Math.random() * 5 + 5))
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

    // 非敏感状态 cookie：前端同步读取，实现首帧秒开（不存实际数据）
    response.cookies.set('logged_in', 'true', {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
    response.cookies.set('survey_status', !!user.survey_completed ? 'done' : 'pending', {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return setCsrfCookie(response)
  } catch (error) {
    console.error('[login]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 })
  }
}
