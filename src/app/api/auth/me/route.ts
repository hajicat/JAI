import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
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

    const decoded = await verifyToken(token)
    if (!decoded) return NextResponse.json({ user: null })

    const db = getDb()
    await initDb()

    const userResult = await db.execute({
      sql: `SELECT id, nickname, email, is_admin, survey_completed,
                  contact_info, contact_type, gender, preferred_gender, conflict_type, match_enabled
            FROM users WHERE id = ?`,
      args: [decoded.id],
    })
    const user = userResult.rows[0] as any
    if (!user) return NextResponse.json({ user: null })

    const codesResult = await db.execute({
      sql: 'SELECT code, current_uses, max_uses FROM invite_codes WHERE created_by = ? AND current_uses < max_uses',
      args: [decoded.id],
    })

    return NextResponse.json({
      user: {
        id: Number(user.id),
        nickname: user.nickname,
        isAdmin: !!user.is_admin,
        surveyCompleted: !!user.survey_completed,
        hasContactInfo: !!user.contact_info,
        contactType: user.contact_type,
        gender: user.gender,
        preferredGender: user.preferred_gender,
        conflictType: user.conflict_type,
        matchEnabled: !!user.match_enabled,
        availableInviteCodes: codesResult.rows,
      },
    })
  } catch (error: any) {
    console.error('[me GET]', error?.message || error)
    return NextResponse.json({ user: null })
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = getTokenFromRequest(req)
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = checkRateLimit(ip, API_LIMITER, 'me-post')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const contactType = sanitizeString(body.contactType || 'wechat', 20)
    const contactInfo = sanitizeString(body.contactInfo || '', 100)
    const matchEnabled = body.matchEnabled

    if (!['wechat', 'qq', 'other'].includes(contactType)) {
      return NextResponse.json({ error: '无效的联系方式类型' }, { status: 400 })
    }

    const infoCheck = validateContactInfo(contactInfo)
    if (!infoCheck.valid) return NextResponse.json({ error: infoCheck.error }, { status: 400 })

    const db = getDb()

    // Build dynamic update
    const updates: string[] = ['contact_type = ?', 'contact_info = ?']
    const args: any[] = [contactType, await encrypt(contactInfo)]

    if (typeof matchEnabled === 'boolean') {
      updates.push('match_enabled = ?')
      args.push(matchEnabled ? 1 : 0)
    }

    args.push(decoded.id)
    await db.execute({
      sql: `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      args,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[me POST]', error?.message || error)
    return NextResponse.json({ error: '保存失败' }, { status: 500 })
  }
}
