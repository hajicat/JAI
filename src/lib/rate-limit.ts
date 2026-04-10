// Simple in-memory rate limiter
// Note: on Cloudflare Workers, memory doesn't persist between invocations
// This is still effective per-instance for burst protection

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()
let cleanupScheduled = false

function scheduleCleanup() {
  if (cleanupScheduled || typeof setInterval !== 'function') return
  cleanupScheduled = true
  try {
    setInterval(() => {
      const now = Date.now()
      for (const key of Array.from(store.keys())) {
        const entry = store.get(key)
        if (entry && now > entry.resetAt) store.delete(key)
      }
    }, 5 * 60 * 1000)
  } catch {
    // setInterval not available in some edge runtimes
  }
}

export interface RateLimitConfig {
  windowMs: number  // Time window in ms
  max: number       // Max requests per window
}

// Pre-configured limiters
export const LOGIN_LIMITER: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 10 }
export const REGISTER_LIMITER: RateLimitConfig = { windowMs: 60 * 60 * 1000, max: 5 }
export const API_LIMITER: RateLimitConfig = { windowMs: 1 * 60 * 1000, max: 60 }
export const SURVEY_LIMITER: RateLimitConfig = { windowMs: 5 * 60 * 1000, max: 10 }

export function checkRateLimit(ip: string, config: RateLimitConfig, action: string): { allowed: boolean; remaining: number; retryAfter: number } {
  scheduleCleanup()
  const key = `${action}:${ip}`
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.max - 1, retryAfter: 0 }
  }

  entry.count++

  if (entry.count > config.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  return { allowed: true, remaining: config.max - entry.count, retryAfter: 0 }
}
