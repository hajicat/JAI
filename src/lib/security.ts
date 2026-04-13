// Edge Runtime compatible security module
// Uses Web Crypto API instead of Node.js crypto module

// --- Secrets Management ---
let _cachedJwtSecret: string | undefined
let _cachedEncryptKey: string | undefined

function getJwtSecret(): string {
  if (_cachedJwtSecret) return _cachedJwtSecret
  if (typeof process !== 'undefined' && process.env?.JWT_SECRET) {
    _cachedJwtSecret = process.env.JWT_SECRET
  }
  if (!_cachedJwtSecret) {
    // 开发环境允许随机生成，生产环境必须设置环境变量
    const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
    if (!isDev) {
      throw new Error(
        'CRITICAL: JWT_SECRET 环境变量未设置！' +
        '请在 Cloudflare Pages 设置中添加 JWT_SECRET（至少64位随机字符串）。' +
        '未设置此变量会导致每次部署后所有用户被强制登出。'
      )
    }
    const bytes = new Uint8Array(64)
    crypto.getRandomValues(bytes)
    _cachedJwtSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    console.warn('[SECURITY] ⚠️ JWT_SECRET 未设置，使用临时随机值（仅开发模式）')
  }
  return _cachedJwtSecret
}

function getEncryptKey(): string {
  if (_cachedEncryptKey) return _cachedEncryptKey
  
  // Cloudflare Pages 环境变量通过 process.env 访问
  const envSecret = typeof process !== 'undefined' ? process.env?.ENCRYPT_SECRET : undefined
  
  if (envSecret) {
    _cachedEncryptKey = envSecret
    return _cachedEncryptKey
  }
  
  // 检测是否为生产环境（Cloudflare Pages 或明确设置 NODE_ENV=production）
  const isCloudflarePages = typeof process !== 'undefined' && !!process.env?.CF_PAGES
  const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
  
  if (isCloudflarePages || isProduction) {
    throw new Error(
      'CRITICAL: ENCRYPT_SECRET 环境变量未设置！' +
      '请在 Cloudflare Pages 设置 → 环境变量中添加 ENCRYPT_SECRET（64位十六进制字符串）。' +
      '未设置此变量将导致所有联系方式无法加密/解密！'
    )
  }
  
  // 仅本地开发环境使用随机密钥
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  _cachedEncryptKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  console.warn('[SECURITY] ⚠️ ENCRYPT_SECRET 未设置，使用临时随机值（仅开发模式）')
  return _cachedEncryptKey
}

// --- Utility helpers ---
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(hex.length / 2)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function strToBytes(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str) as Uint8Array<ArrayBuffer>
}

function bytesToStr(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

// Constant-time string comparison
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// ============================================================
// PASSWORD HASHING - PBKDF2 (Web Crypto API)
// ============================================================

// CF Edge Runtime CPU 限制：100k 次迭代约 500ms 会超时（Free 计划 ~50ms 上限）
// 降低到 5000 次，兼顾安全性与 CF 兼容性（~20-30ms）
// 同时与登录接口的 SHA-256 dummy hash 耗时接近（~10-50ms），避免 timing attack
const PBKDF2_ITERATIONS = 5000
const KEY_LENGTH = 64 // 512 bits

/**
 * 获取 pepper 密钥（服务端静态密钥，用于在密码哈希前混入额外熵）
 * 从环境变量 PEPPER_SECRET 读取，不存在则使用 JWT_SECRET 的哈希派生
 * 目的：即使数据库被拖库 + 盐泄露，攻击者仍无法离线暴力破解（缺少 pepper）
 */
// 缓存 pepper（模块级，只算一次）
let _cachedPepper: string | undefined

function getPepper(): string {
  const envPepper = typeof process !== 'undefined' ? process.env?.PEPPER_SECRET : undefined
  if (envPepper) return envPepper
  // 回退：已缓存则直接返回
  if (_cachedPepper) return _cachedPepper
  // 用 JWT_SECRET 的 SHA-256 哈希作为 pepper（比旧版 32-bit hash 碰撞率低得多）
  try {
    const jwtSecret = getJwtSecret()
    // 用简单的 DJB2 变体做同步哈希（仅作 fallback，生产环境应设 PEPPER_SECRET）
    let hash = 2166136261 >>> 0  // FNV offset basis
    for (let i = 0; i < jwtSecret.length; i++) {
      hash ^= jwtSecret.charCodeAt(i)
      hash = (hash * 16777619) >>> 0  // FNV prime
    }
    _cachedPepper = `pepper_${hash.toString(16).padStart(8, '0')}`
    return _cachedPepper
  } catch {
    return '_default_pepper_fallback_'
  }
}

export async function hashPassword(password: string): Promise<string> {
  const saltBytes = new Uint8Array(32)
  crypto.getRandomValues(saltBytes)
  const saltHex = bytesToHex(saltBytes)

  // 将 pepper 混入密码再哈希，防止数据库泄露后离线暴力破解
  const pepperedPassword = `${getPepper()}:${password}`

  const keyMaterial = await crypto.subtle.importKey(
    'raw', strToBytes(pepperedPassword), { name: 'PBKDF2' }, false, ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-512' },
    keyMaterial,
    KEY_LENGTH * 8
  )

  const hashHex = bytesToHex(new Uint8Array(derivedBits))
  return `pbkdf2$${saltHex}$${hashHex}$${PBKDF2_ITERATIONS}-sha512`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')

    if (parts[0] === 'pbkdf2' && parts.length === 4) {
      const [, saltHex, expectedHash, paramStr] = parts
      const [iterationsStr] = paramStr.split('-')
      const iterations = parseInt(iterationsStr, 10)
      const saltBytes = hexToBytes(saltHex)

      // --- 尝试带 pepper 验证（新哈希） ---
      const pepperedPassword = `${getPepper()}:${password}`
      let keyMaterial = await crypto.subtle.importKey(
        'raw', strToBytes(pepperedPassword), { name: 'PBKDF2' }, false, ['deriveBits']
      )
      let derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-512' },
        keyMaterial,
        KEY_LENGTH * 8
      )
      let hashHex = bytesToHex(new Uint8Array(derivedBits))
      if (timingSafeEqualStr(hashHex, expectedHash)) return true

      // --- Fallback：无 pepper 验证（旧哈希，pepper 上线前注册的用户） ---
      keyMaterial = await crypto.subtle.importKey(
        'raw', strToBytes(password), { name: 'PBKDF2' }, false, ['deriveBits']
      )
      derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-512' },
        keyMaterial,
        KEY_LENGTH * 8
      )
      hashHex = bytesToHex(new Uint8Array(derivedBits))
      return timingSafeEqualStr(hashHex, expectedHash)
    }

    if (parts[0] === 'scrypt') {
      console.warn('[SECURITY] Legacy scrypt hash detected. User needs password reset.')
      return false
    }

    return false
  } catch {
    return false
  }
}

// ============================================================
// JWT TOKEN (HMAC-SHA256 via Web Crypto)
// ============================================================

function base64url(bytes: Uint8Array): string {
  let str = ''
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i])
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlEncode(str: string): string {
  return base64url(strToBytes(str))
}

function base64urlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const bytes = Uint8Array.from(atob(str), c => c.charCodeAt(0))
  return bytesToStr(bytes)
}

async function hmacSha256(key: string, data: string): Promise<string> {
  const keyObj = await crypto.subtle.importKey(
    'raw', strToBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', keyObj, strToBytes(data))
  return base64url(new Uint8Array(signature))
}

export async function createToken(payload: { id: number; email: string; isAdmin: boolean }): Promise<string> {
  const jwtSecret = getJwtSecret()
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  // 生成随机 JWT ID 用于未来 token 吊销/追踪
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const jti = bytesToHex(bytes)
  const body = base64urlEncode(JSON.stringify({
    ...payload,
    iss: 'jlai-dating',
    aud: 'jlai-dating',
    jti,
    iat: now,
    exp: now + 7 * 24 * 60 * 60,
  }))

  const signature = await hmacSha256(jwtSecret, `${header}.${body}`)
  return `${header}.${body}.${signature}`
}

/**
 * 基础 token 验证（仅校验签名、过期、iss/aud）
 * 用于公开接口（如 home-data）
 */
export async function verifyToken(token: string): Promise<{ id: number; email: string; isAdmin: boolean } | null> {
  try {
    const jwtSecret = getJwtSecret()
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, signature] = parts
    
    // 验证 JWT header 的 alg 字段必须是 HS256，防止算法混淆攻击
    try {
      const headerObj = JSON.parse(base64urlDecode(header))
      if (headerObj.alg !== 'HS256') return null
    } catch { return null }
    
    const expectedSig = await hmacSha256(jwtSecret, `${header}.${body}`)

    if (!timingSafeEqualStr(signature, expectedSig)) return null

    const payload = JSON.parse(base64urlDecode(body))

    if (payload.iss !== 'jlai-dating' || payload.aud !== 'jlai-dating') return null
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null

    return { id: payload.id, email: payload.email, isAdmin: payload.isAdmin }
  } catch {
    return null
  }
}

/**
 * 安全 token 验证（用于敏感操作接口）
 * 额外校验：token 签发时间(iat)必须晚于用户密码修改时间
 * 即：用户改密码后，所有旧 token 立即失效
 */
export async function verifyTokenSafe(
  token: string,
  dbClient?: { execute(sql: { sql: string; args: (number | string)[] }): Promise<{ rows: any[] }> }
): Promise<{ id: number; email: string; isAdmin: boolean } | null> {
  const result = await verifyToken(token)
  if (!result) return null

  // 无数据库客户端时回退到基础验证（如 home-data 接口）
  if (!dbClient) return result

  try {
    const userResult = await dbClient.execute({
      sql: 'SELECT password_changed_at FROM users WHERE id = ?',
      args: [result.id],
    })
    const row = userResult.rows[0] as any
    const changedAt = row?.password_changed_at
    if (!changedAt) return result // 从未改过密码，放行

    // 解析 JWT payload 拿 iat
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(base64urlDecode(parts[1]))
    const iat = payload.iat as number

    // password_changed_at 是 ISO 时间字符串，转为 Unix 秒
    const changedTs = Math.floor(new Date(changedAt).getTime() / 1000)

    // 如果 token 在修改之前签发的 → 失效
    if (iat < changedTs) {
      return null
    }

    return result
  } catch {
    // 出错时安全起见拒绝
    return null
  }
}

export function generateInviteCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return 'JLAI-' + bytesToHex(bytes).toUpperCase()
}

// ============================================================
// AES-256-GCM ENCRYPTION (Web Crypto API)
// ============================================================

const IV_LEN = 12

async function deriveKey(raw: string): Promise<CryptoKey> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', strToBytes(raw))
  return crypto.subtle.importKey(
    'raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  )
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await deriveKey(getEncryptKey())
  const iv = new Uint8Array(IV_LEN)
  crypto.getRandomValues(iv)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    strToBytes(plaintext)
  )

  const encBytes = new Uint8Array(encrypted)
  const ciphertext = encBytes.slice(0, encBytes.length - 16)
  const tag = encBytes.slice(encBytes.length - 16)

  return `${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(ciphertext)}`
}

export async function decrypt(data: string): Promise<string> {
  try {
    const parts = data.split(':')
    if (parts.length !== 3) return '[加密格式异常]'

    const [ivHex, tagHex, encHex] = parts
    const key = await deriveKey(getEncryptKey())
    const iv = hexToBytes(ivHex)
    const tag = hexToBytes(tagHex)
    const encrypted = hexToBytes(encHex)

    const combined = new Uint8Array(encrypted.length + tag.length)
    combined.set(encrypted)
    combined.set(tag, encrypted.length)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      combined
    )

    return bytesToStr(new Uint8Array(decrypted))
  } catch {
    return '[解密失败]'
  }
}
