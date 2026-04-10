import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // ---- Security Headers ----

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY')

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff')

  // XSS Protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block')

  // Referrer Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Permissions Policy - restrict browser features
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  // Content Security Policy - relaxed for Cloudflare Pages compatibility
  const isDev = process.env.NODE_ENV !== 'production'
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  )

  // HSTS - force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    )
  }

  // Remove server identification
  response.headers.delete('X-Powered-By')

  // Set CSRF token cookie if not present (using Web Crypto API for Edge compatibility)
  if (!request.cookies.get('csrf-token')?.value) {
    // Generate random bytes using Web Crypto API (available in Edge Runtime)
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const csrfToken = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    response.cookies.set('csrf-token', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
