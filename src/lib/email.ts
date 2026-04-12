/**
 * 邮件验证码模块 — 基于 Brevo（SendinBlue）API
 * 无需额外依赖，纯 fetch 调用，完美兼容 Cloudflare Edge Runtime
 *
 * 安全设计：
 * - 验证码以 SHA-256 哈希存储，不存明文
 * - 6 位数字码，5 分钟过期，最多尝试 5 次
 * - 同一邮箱 60 秒冷却防刷
 */

// ── 配置 ──
const CODE_EXPIRY_MS = 5 * 60 * 1000       // 5 分钟
const CODE_COOLDOWN_MS = 60 * 1000         // 60 秒冷却
const MAX_ATTEMPTS = 5                      // 最大尝试验证次数
const CODE_LENGTH = 6                       // 6 位数字

// Brevo API 配置
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

export interface VerificationCodeResult {
  success: boolean
  message: string
  error?: string
}

/**
 * 获取发件人地址（从环境变量读取）
 * Brevo 需要先在 Dashboard → Senders 中验证发件邮箱
 */
function getFromEmail(): string {
  return process.env.BREVO_FROM_EMAIL || 'noreply@jaihelp.icu'
}

/**
 * 生成随机 6 位数字验证码
 */
function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += String.fromCharCode(48 + (bytes[i] % 10))  // 48 = '0'
  }
  return code
}

/**
 * 用 SHA-256 哈希验证码（存数据库用，永不存明文）
 */
async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(`jlai-verify:${code}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 通过 Brevo API 发送邮件（纯 fetch，无外部依赖）
 */
async function sendViaBrevo(
  toEmail: string,
  subject: string,
  htmlContent: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    return { success: false, error: '未配置 BREVO_API_KEY' }
  }

  const fromName = '吉动盲盒'
  const fromEmail = getFromEmail()

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: toEmail }],
        subject,
        htmlContent,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      console.error('[brevo] HTTP error:', response.status, body)
      return { success: false, error: `Brevo ${response.status}: ${body}` }
    }

    const data: any = await response.json()
    console.log(`[brevo] 验证码已发送 → ${toEmail} (messageId: ${data?.messageId})`)
    return { success: true, messageId: data?.messageId }
  } catch (err: any) {
    console.error('[brevo] 异常:', err?.message || err)
    return { success: false, error: err?.message || '网络请求失败' }
  }
}

/**
 * 构建验证码邮件 HTML
 */
function buildEmailHtml(code: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px;">🎁</span>
        <h1 style="color: #333; margin: 12px 0 4px; font-size: 20px;">吉动盲盒</h1>
        <p style="color: #888; font-size: 14px; margin: 0;">邮箱验证码</p>
      </div>

      <div style="background: linear-gradient(135deg, #ec4899, #a855f7); border-radius: 16px; padding: 32px; text-align: center; margin: 24px 0;">
        <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0 0 12px;">你的验证码是</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #fff;">
          ${code.split('').join(' ')}
        </div>
        <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 16px 0 0;">有效期 5 分钟</p>
      </div>

      <div style="background: #f8f8f8; border-radius: 12px; padding: 16px; font-size: 13px; color: #666; line-height: 1.6;">
        <p style="margin: 0 0 8px;">⏰ 验证码 <strong>5 分钟</strong>内有效</p>
        <p style="margin: 0 0 8px;">🔒 请勿将验证码告诉他人</p>
        <p style="margin: 0;">如果不是你本人操作，请忽略此邮件</p>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="text-align: center; color: #aaa; font-size: 12px; margin: 0;">
        此邮件由系统自动发送，请勿回复<br />
        吉动盲盒 &mdash; 发现校园缘分 ✨
      </p>
    </div>
  `
}

/**
 * 发送邮箱验证码邮件
 *
 * @param email 目标邮箱
 * @param db 数据库客户端（用于存储哈希后的验证码）
 * @param ip 请求者 IP（用于限流）
 *
 * @returns 成功时 success=true；失败时返回错误信息
 */
export async function sendVerificationEmail(
  email: string,
  db: any,
  ip: string
): Promise<VerificationCodeResult> {
  const now = new Date()

  // ── 1. 冷却检查：同一邮箱 60 秒内不能重发 ──
  try {
    const recentResult = await db.execute({
      sql: `SELECT created_at FROM verification_codes
            WHERE email = ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [email.toLowerCase()],
    })
    if (recentResult.rows.length > 0) {
      const lastSent = new Date((recentResult.rows[0] as any).created_at)
      const elapsed = now.getTime() - lastSent.getTime()
      if (elapsed < CODE_COOLDOWN_MS) {
        const remainingSec = Math.ceil((CODE_COOLDOWN_MS - elapsed) / 1000)
        return {
          success: false,
          error: `请等待 ${remainingSec} 秒后再发送`,
          message: `操作太频繁，请 ${remainingSec} 秒后再试`,
        }
      }
    }
  } catch (_) {
    /* 表可能还不存在，继续执行 */
  }

  // ── 2. 清理过期记录 ──
  try {
    const expiryCutoff = new Date(now.getTime() - CODE_EXPIRY_MS).toISOString()
    await db.execute({
      sql: `DELETE FROM verification_codes WHERE created_at < ? OR attempts >= ?`,
      args: [expiryCutoff, MAX_ATTEMPTS],
    })
  } catch (_) {
    /* 忽略清理错误 */
  }

  // ── 3. 生成验证码并哈希 ──
  const plainCode = generateCode()
  const codeHash = await hashCode(plainCode)

  // ── 4. 存储到数据库 ──
  const expiresAt = new Date(now.getTime() + CODE_EXPIRY_MS).toISOString()
  try {
    await db.execute({
      sql: `INSERT INTO verification_codes (email, code_hash, expires_at, ip, attempts, created_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
      args: [email.toLowerCase(), codeHash, expiresAt, ip, now.toISOString()],
    })
  } catch (err: any) {
    console.error('[email] 存储验证码失败:', err?.message || err)
    return {
      success: false,
      error: '系统错误，请稍后重试',
      message: '验证码生成失败',
    }
  }

  // ── 5. 通过 Brevo API 发送邮件 ──
  const result = await sendViaBrevo(
    email,
    '你的吉动盲盒验证码',
    buildEmailHtml(plainCode),
  )

  if (!result.success) {
    return {
      success: false,
      error: `邮件发送失败（${result.error}）`,
      message: `验证码发送失败，请稍后重试`,
    }
  }

  return {
    success: true,
    message: '验证码已发送，请查收邮箱',
  }
}

/**
 * 验证用户提交的验证码是否正确
 *
 * @param email 用户邮箱
 * @param userInput 用户输入的验证码
 * @param db 数据库客户端
 *
 * @returns valid=true 表示验证通过
 */
export async function verifyCode(
  email: string,
  userInput: string,
  db: any
): Promise<{ valid: boolean; error?: string }> {
  if (!userInput || typeof userInput !== 'string' || !/^\d{6}$/.test(userInput)) {
    return { valid: false, error: '验证码格式不正确' }
  }

  const inputHash = await hashCode(userInput)
  const emailLower = email.toLowerCase()
  const nowIso = new Date().toISOString()

  try {
    // 查找未过期的有效验证码记录
    const result = await db.execute({
      sql: `SELECT id, code_hash, attempts, expires_at FROM verification_codes
            WHERE email = ? AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [emailLower, nowIso],
    })

    const row = result.rows[0] as any
    if (!row) {
      return { valid: false, error: '验证码已过期或不存在' }
    }

    // 检查尝试次数
    if (row.attempts >= MAX_ATTEMPTS) {
      await db.execute({ sql: `DELETE FROM verification_codes WHERE id = ?`, args: [row.id] })
      return { valid: false, error: '验证码尝试次数过多，请重新获取' }
    }

    // 增加尝试计数
    await db.execute({
      sql: `UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`,
      args: [row.id],
    })

    // 常量时间比较防时序攻击
    const storedHash = String(row.code_hash)
    const match = timingSafeEqual(inputHash, storedHash)

    if (match) {
      // 验证成功，删除该码防止重复使用
      await db.execute({ sql: `DELETE FROM verification_codes WHERE id = ?`, args: [row.id] })
      return { valid: true }
    } else {
      const remaining = MAX_ATTEMPTS - Number(row.attempts) - 1
      return { valid: false, error: `验证码错误，还剩 ${remaining} 次机会` }
    }
  } catch (err: any) {
    console.error('[verify-code]', err?.message || err)
    return { valid: false, error: '验证失败，请稍后重试' }
  }
}

/**
 * 常量时间字符串比较 — 防时序攻击
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  let result = 0
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i]
  }
  return result === 0
}
