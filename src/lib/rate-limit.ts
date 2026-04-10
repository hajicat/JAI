/**
 * Rate Limiter for Cloudflare Workers / Edge Runtime
 *
 * NOTE: On Cloudflare Workers, each request may run on a different isolate.
 * Memory-based limiting (Map) only persists within a single isolate instance.
 * For true distributed rate limiting, migrate to Cloudflare KV or Durable Objects.
 *
 * Current behavior:
 * - Per-isolate burst protection (effective for rapid repeated requests)
 * - Conservative limits recommended since actual enforcement varies by instance
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

// Use globalThis for better persistence within a single worker isolate
const getStore = (): Map<string, RateLimitEntry> => {
  if (!(globalThis as any).__rateLimitStore) {
    (globalThis as any).__rateLimitStore = new Map<string, RateLimitEntry>()
  }
  return (globalThis as any).__rateLimitStore
}

function cleanup() {
  const store = getStore()
  const now = Date.now()
  for (const key of Array.from(store.keys())) {
    const entry = store.get(key)
    if (entry && now > entry.resetAt) store.delete(key)
  }
}

export interface RateLimitConfig {
  windowMs: number   // Time window in ms
  max: number        // Max requests per window
}

// Pre-configured limiters (conservative for distributed environments)
export const LOGIN_LIMITER: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 10 }
export const REGISTER_LIMITER: RateLimitConfig = { windowMs: 60 * 60 * 1000, max: 5 }
export const API_LIMITER: RateLimitConfig = { windowMs: 1 * 60 * 1000, max: 60 }
export const SURVEY_LIMITER: RateLimitConfig = { windowMs: 5 * 60 * 1000, max: 10 }

export function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
  action: string
): { allowed: boolean; remaining: number; retryAfter: number } {
  // Periodic cleanup (cheap, runs once per call cycle)
  if (Math.random() < 0.01) cleanup()

  const store = getStore()
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
