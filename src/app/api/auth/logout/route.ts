import { NextRequest, NextResponse } from 'next/server'
import { validateCsrfToken } from '@/lib/csrf'

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  // CSRF protection — 必须与 cookie 值比对，防止伪造请求强制登出
  if (!validateCsrfToken(req)) {
    return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
  }
  const response = NextResponse.json({ success: true })

  // Clear both possible cookie names (with and without __Host- prefix)
  for (const name of ['token', '__Host-token', 'csrf-token', '__Host-csrf-token']) {
    response.cookies.set(name, '', {
      httpOnly: name !== 'csrf-token',
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }

  return response
}
