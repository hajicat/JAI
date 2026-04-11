import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken, generateInviteCode } from '@/lib/auth'
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
      SELECT ic.id, ic.code, ic.current_uses, ic.max_uses, ic.created_at,
        u.nickname as created_by_name,
        u2.nickname as used_by_name
      FROM invite_codes ic
      JOIN users u ON ic.created_by = u.id
      LEFT JOIN users u2 ON ic.used_by = u2.id
      ORDER BY ic.created_at DESC
    `)

    return NextResponse.json({ codes: result.rows })
  } catch (error: any) {
    console.error('[admin/codes GET]', error?.message || error)
    return NextResponse.json({ error: '获取邀请码失败' }, { status: 500 })
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
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-codes')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const count = Math.min(Math.max(Number(body.count) || 5, 1), 20)

    const db = getDb()
    const newCodes: string[] = []
    for (let i = 0; i < count; i++) {
      const code = generateInviteCode()
      await db.execute({
        sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
        args: [code, decoded.id],
      })
      newCodes.push(code)
    }

    return NextResponse.json({ success: true, codes: newCodes })
  } catch (error: any) {
    console.error('[admin/codes POST]', error?.message || error)
    return NextResponse.json({ error: '生成邀请码失败' }, { status: 500 })
  }
}
