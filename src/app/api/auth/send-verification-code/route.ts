import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { validateEmail, sanitizeString } from '@/lib/validation'
import { checkRateLimit, REGISTER_LIMITER, checkRateLimitByEmail, EMAIL_CODE_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken } from '@/lib/csrf'
import { sendVerificationEmail } from '@/lib/email'

export const runtime = 'edge'

// 发送验证码的独立限流（首次宽松，后续严格）
const CODE_SEND_LIMITER = {
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 20,
}

export async function POST(req: NextRequest) {
  try {
    // CSRF 保护
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)

    // IP 级别限流（防止同一 IP 疯狂发码）
    const rateResult = await checkRateLimit(ip, CODE_SEND_LIMITER, 'send_code')
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: `发送太频繁了，请 ${rateResult.retryAfter} 秒后再试` },
        { status: 429, headers: { 'Retry-After': String(rateResult.retryAfter) } }
      )
    }

    // 解析请求体
    const body = await req.json()
    const email = sanitizeString(body.email || '', 254).toLowerCase()

    // 邮箱维度限流（防止单个邮箱被滥用）
    const emailRateResult = await checkRateLimitByEmail(email, EMAIL_CODE_LIMITER, 'send_code')
    if (!emailRateResult.allowed) {
      return NextResponse.json(
        { error: '该邮箱发送验证码太频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(emailRateResult.retryAfter) } }
      )
    }

    // 邮箱格式校验
    const emailCheck = validateEmail(email)
    if (!emailCheck.valid) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 })
    }

    // 检查邮箱是否已注册 — 不暴露是否存在，与 forgot-password 保持一致（防枚举）
    const db = getDb()
    await initDb()

    try {
      const existing = await db.execute({
        sql: "SELECT id FROM users WHERE LOWER(email) = ?",
        args: [email],
      })
      if (existing.rows.length > 0) {
        // 邮箱已存在，返回成功但不实际发码（防枚举：攻击者无法区分"已注册"和"发送成功"）
        return NextResponse.json({ success: true, message: '验证码已发送，请查收邮箱' })
      }
    } catch (_) {
      /* 表可能不存在，继续 */
    }

    // 发送验证码邮件
    const result = await sendVerificationEmail(email, db, ip)

    if (!result.success) {
      return NextResponse.json({ error: result.error || '发送失败' }, { status: 429 })
    }

    return NextResponse.json({ success: true, message: result.message })

  } catch (error: any) {
    const errMsg = error?.message || error?.toString() || 'unknown'
    console.error('[send-verification-code]', errMsg)
    return NextResponse.json({ error: '系统错误，请稍后重试', detail: errMsg }, { status: 500 })
  }
}
