import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/crypto'
import { validateContactInfo, sanitizeString } from '@/lib/validation'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

function getTokenFromRequest(req: NextRequest): string | undefined {
  const cookieName = getCookieName('token')
  return req.cookies.get(cookieName)?.value
}

export async function GET(req: NextRequest) {
  try {
    const token = getTokenFromRequest(req)
    if (!token) return NextResponse.json({ user: null })

    const db = getDb()
    await initDb()

    // 使用 verifyTokenSafe：确保用户改密码后旧 token 立即失效
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ user: null })

    const userResult = await db.execute({
      sql: `SELECT id, nickname, email, is_admin, survey_completed,
                  contact_info, contact_type, gender, preferred_gender, conflict_type,
                  match_enabled, verification_status, verification_score
            FROM users WHERE id = ?`,
      args: [decoded.id],
    })
    const user = userResult.rows[0] as any
    if (!user) return NextResponse.json({ user: null })

    const codesResult = await db.execute({
      sql: 'SELECT code, current_uses, max_uses FROM invite_codes WHERE created_by = ? AND current_uses < max_uses',
      args: [decoded.id],
    })

    // 解密联系方式（如果有）
    let contactInfo = ''
    if (user.contact_info) {
      try {
        contactInfo = await decrypt(String(user.contact_info))
      } catch (error) {
        console.error('[me GET] decrypt contact info failed:', error)
        // 解密失败时返回空字符串
      }
    }

    // 判断是否需要 GPS 验证：无校内邮箱的学校用户需要，有校内邮箱的学校用户不需要
    // emailDomain 是 split('@')[1] 的结果，已不含 @ 符号
    // 与 SCHOOL_EMAIL_DOMAINS（register/route.ts）保持一致
    const emailDomain = String(user.email || '').split('@')[1] || ''
    const SCHOOL_EMAIL_DOMAINS = ['jlu.edu.cn','mails.jlu.edu.cn','mails.cust.edu.cn','stu.ccut.edu.cn','jlju.edu.cn','nenu.edu.cn','jisu.edu.cn','mails.ccu.edu.cn','ccucm.edu.cn']
    const needsGpsVerification = !SCHOOL_EMAIL_DOMAINS.includes(emailDomain)
    const currentVerificationStatus = user.verification_status || null
    const currentScore = user.verification_score != null ? Number(user.verification_score) : null

    return NextResponse.json({
      user: {
        id: Number(user.id),
        nickname: user.nickname,
        isAdmin: !!user.is_admin,
        surveyCompleted: !!user.survey_completed,
        hasContactInfo: !!user.contact_info,
        contactInfo: contactInfo,
        contactType: user.contact_type,
        gender: user.gender,
        preferredGender: user.preferred_gender,
        conflictType: user.conflict_type,
        matchEnabled: !!user.match_enabled,
        availableInviteCodes: codesResult.rows,
        verificationStatus: currentVerificationStatus,
        verificationScore: currentScore,
        needsGpsVerification,
      },
    })
  } catch (error) {
    console.error('[me GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ user: null })
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = getTokenFromRequest(req)
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()

    // 使用 verifyTokenSafe：确保用户改密码后旧 token 立即失效
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'me-post')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const contactType = sanitizeString(body.contactType || 'wechat', 20)
    const contactInfo = sanitizeString(body.contactInfo || '', 19)
    const matchEnabled = body.matchEnabled

    // Only validate contact type if contact info is being updated
    if (contactInfo) {
      if (!['wechat', 'qq', 'other'].includes(contactType)) {
        return NextResponse.json({ error: '无效的联系方式类型' }, { status: 400 })
      }

      const infoCheck = validateContactInfo(contactInfo)
      if (!infoCheck.valid) return NextResponse.json({ error: infoCheck.error }, { status: 400 })
    }

    // Build dynamic update - only update fields that are provided
    const updates: string[] = []
    const args: any[] = []

    if (contactInfo && contactType) {
      updates.push('contact_type = ?', 'contact_info = ?')
      // 注意：联系方式直接用 sanitizeString 清理即可，不要用 sanitizeForStorage（后者做 HTML 转义会永久篡改数据）
      args.push(contactType, await encrypt(contactInfo))
    }

    if (typeof matchEnabled === 'boolean') {
      updates.push('match_enabled = ?')
      args.push(matchEnabled ? 1 : 0)
    }

    // At least one field must be updated
    if (updates.length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
    }

    args.push(decoded.id)
    await db.execute({
      sql: `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      args,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[me POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '保存失败' }, { status: 500 })
  }
}
