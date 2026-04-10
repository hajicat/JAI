import { NextRequest, NextResponse } from 'next/server'

/**
 * CSRF Protection - Double Submit Cookie Pattern
 */

const CSRF_TOKEN_LENGTH = 32

function generateCsrfToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Validate CSRF token from request.
 * Returns true if the request is safe (GET/HEAD/OPTIONS) or if the token matches.
 */
export function validateCsrfToken(req: NextRequest): boolean {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true
  }

  const cookieToken = req.cookies.get('csrf-token')?.value
  const headerToken = req.headers.get('x-csrf-token')

  if (!cookieToken || !headerToken) {
    return false
  }

  // Constant-time comparison
  if (cookieToken.length !== headerToken.length) return false
  let result = 0
  for (let i = 0; i < cookieToken.length; i++) {
    result |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i)
  }
  return result === 0
}

/**
 * Set CSRF token cookie on a response.
 */
export function setCsrfCookie(response: NextResponse): NextResponse {
  const token = generateCsrfToken()
  response.cookies.set('csrf-token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  return response
}

/**
 * Extract client IP from request.
 * Priority: CF connectingIp (most reliable) > x-forwarded-for (fallback)
 */
export function getClientIp(req: NextRequest): string {
  // Cloudflare Workers: use connectingIp for real client IP (cannot be spoofed by user)
  const cf = (req as any).cf as { connectingIp?: string } | undefined
  if (cf?.connectingIp) {
    return cf.connectingIp
  }

  // Fallback for non-CF environments
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const firstIp = forwarded.split(',')[0]?.trim()
    if (firstIp && isValidIp(firstIp)) {
      return firstIp
    }
  }

  return 'unknown'
}

function isValidIp(ip: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/
  const ipv6 = /^[0-9a-fA-F:]+$/
  return ipv4.test(ip) || ipv6.test(ip)
}

/**
 * Get cookie name with __Host- prefix in production.
 */
export function getCookieName(name: string): string {
  return process.env.NODE_ENV === 'production' ? `__Host-${name}` : name
}
