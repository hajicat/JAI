import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { validateEmail, sanitizeString } from '@/lib/validation'
import { checkRateLimit, REGISTER_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken } from '@/lib/csrf'
import { sendVerificationEmail, isDevMode } from '@/lib/email'

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

    // 邮箱格式校验
    const emailCheck = validateEmail(email)
    if (!emailCheck.valid) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 })
    }

    // 检查邮箱是否已注册（注册阶段提示友好信息）
    const db = getDb()
    await initDb()

    try {
      const existing = await db.execute({
        sql: "SELECT id FROM users WHERE LOWER(email) = ?",
        args: [email],
      })
      if (existing.rows.length > 0) {
        return NextResponse.json({ error: '该邮箱已被注册' }, { status: 400 })
      }
    } catch (_) {
      /* 表可能不存在，继续 */
    }

    // 发送验证码邮件
    const result = await sendVerificationEmail(email, db, ip)

    if (!result.success) {
      return NextResponse.json({ error: result.error || '发送失败' }, { status: 429 })
    }

    // 返回成功响应
    // 开发模式额外返回明文码（仅开发环境！）
    const responsePayload: any = {
      success: true,
      message: result.message,
    }
    if (isDevMode() && result.codeForDev) {
      responsePayload.devCode = result.codeForDev
    }

    return NextResponse.json(responsePayload)
  } catch (error: any) {
    console.error('[send-verification-code]', error?.message || error)
    return NextResponse.json({ error: '系统错误，请稍后重试' }, { status: 500 })
  }
}
