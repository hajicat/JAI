/**
 * Rate Limiter for Cloudflare Workers / Edge Runtime
 *
 * 支持两种模式：
 * 1. **KV 模式**（生产/有 KV 绑定时）：使用 Cloudflare KV 做分布式限流
 *    - 所有 isolate 共享同一份数据
 *    - 需要在 Cloudflare Dashboard 创建 KV namespace 并绑定到项目
 * 2. **内存 Map 模式**（开发环境/KV 不可用时）：
 *    - 仅在单个 isolate 内有效（与旧版行为一致）
 *    - 用于本地开发和未配置 KV 时 fallback
 *
 * ## 配置步骤（一次性）
 * 1. 登录 Cloudflare Dashboard → Workers & Pages → KV → Create namespace
 *    名称填：`jlai-rate-limit`
 * 2. 进入项目 Settings → Variables → Bindings
 *    添加 KV Binding：
 *      Variable name: RATE_LIMIT_KV
 *      选择刚创建的 namespace: jlai-rate-limit
 * 3. 重新部署即可生效
 *
 * ## 免费额度参考
 * - 读取：100,000 次/天（你们的应用绰绰有余）
 * - 写入：1,000 次/天（够用）
 * - 存储：无限制
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

export interface RateLimitConfig {
  windowMs: number   // Time window in ms
  max: number        // Max requests per window
}

// Pre-configured limiters
export const LOGIN_LIMITER: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 10 }
export const REGISTER_LIMITER: RateLimitConfig = { windowMs: 60 * 60 * 1000, max: 5 }
export const API_LIMITER: RateLimitConfig = { windowMs: 1 * 60 * 1000, max: 60 }
export const SURVEY_LIMITER: RateLimitConfig = { windowMs: 5 * 60 * 1000, max: 10 }

// ============================================================
// KV-based rate limiting (production / when KV binding exists)
// ============================================================

function getKV(): any | null {
  // Cloudflare Pages 绑定通过 globalThis 访问
  try {
    const kv = (globalThis as any)?.RATE_LIMIT_KV
    return kv || null
  } catch {
    return null
  }
}

async function checkRateLimitKV(
  ip: string,
  config: RateLimitConfig,
  action: string
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const kv = getKV()
  if (!kv) throw new Error('KV not available')

  const kvKey = `rl:${action}:${ip}`
  const now = Date.now()

  const raw = await kv.get(kvKey)
  let entry: RateLimitEntry

  if (!raw) {
    entry = { count: 1, resetAt: now + config.windowMs }
  } else {
    entry = JSON.parse(raw) as RateLimitEntry
    if (now > entry.resetAt) {
      // Window expired, reset
      entry = { count: 1, resetAt: now + config.windowMs }
    } else {
      entry.count++
    }
  }

  // TTL 设为窗口期（KV 自动过期清理）
  const ttlSeconds = Math.ceil(config.windowMs / 1000) + 10
  await kv.put(kvKey, JSON.stringify(entry), { expirationTtl: ttlSeconds })

  if (entry.count > config.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  return { allowed: true, remaining: config.max - entry.count, retryAfter: 0 }
}

// ============================================================
// Memory-based fallback (development / no KV binding)
// ============================================================

function getStore(): Map<string, RateLimitEntry> {
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

function checkRateLimitMemory(
  ip: string,
  config: RateLimitConfig,
  action: string
): { allowed: boolean; remaining: number; retryAfter: number } {
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

// ============================================================
// Public API — auto-detects KV vs Memory mode
// ============================================================

let _useKV: boolean | null = null

/** Detect once whether KV is available, cache result */
function detectKVAvailable(): boolean {
  if (_useKV !== null) return _useKV
  _useKV = getKV() !== null
  return _useKV
}

export function resetKVCache(): void {
  _useKV = null
}

export async function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
  action: string
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  if (detectKVAvailable()) {
    return checkRateLimitKV(ip, config, action)
  }
  return Promise.resolve(checkRateLimitMemory(ip, config, action))
}
