import { createClient, type Client } from '@libsql/client'

let client: Client | null = null
let dbInitialized = false
let initPromise: Promise<void> | null = null

export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL
    const token = process.env.TURSO_AUTH_TOKEN

    if (url && token) {
      client = createClient({ url, authToken: token })
    } else if (url) {
      // Local libsql (for dev without auth)
      client = createClient({ url })
    } else {
      // On Cloudflare Edge runtime, TURSO_DATABASE_URL is required
      // Local SQLite fallback is not available in edge/serverless environments
      throw new Error(
        'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables are required. ' +
        'See CF-DEPLOY.md for setup instructions.'
      )
    }
  }
  return client
}

// Campus center coordinates (吉林动画学院 博识路168号)
export const CAMPUS_LAT = 43.8188
export const CAMPUS_LNG = 125.3178
export const CAMPUS_RADIUS_KM = 1.0

export async function initDb(): Promise<void> {
  if (dbInitialized) return
  // 防止并发请求重复执行初始化：复用同一个 Promise
  if (initPromise) { await initPromise; return }
  
  initPromise = doInit()
  try { await initPromise }
  catch (_e) { initPromise = null; throw } // 失败后允许重试
}

async function doInit(): Promise<void> {
  const db = getDb()

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      invited_by INTEGER REFERENCES users(id),
      is_admin INTEGER DEFAULT 0,
      gender TEXT,
      preferred_gender TEXT,
      survey_completed INTEGER DEFAULT 0,
      contact_info TEXT,
      contact_type TEXT DEFAULT 'wechat',
      conflict_type TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      last_match_date TEXT,
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      match_enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      used_by INTEGER REFERENCES users(id),
      max_uses INTEGER DEFAULT 1,
      current_uses INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS survey_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT,
      q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT,
      q11 TEXT, q12 TEXT, q13 TEXT, q14 TEXT, q15 TEXT,
      q16 TEXT, q17 TEXT, q18 TEXT, q19 TEXT, q20 TEXT,
      q21 TEXT, q22 TEXT, q23 TEXT, q24 TEXT, q25 TEXT,
      q26 TEXT, q27 TEXT, q28 TEXT, q29 TEXT, q30 TEXT,
      q31 TEXT, q32 TEXT, q33 TEXT, q34 TEXT, q35 TEXT,
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a INTEGER NOT NULL REFERENCES users(id),
      user_b INTEGER NOT NULL REFERENCES users(id),
      score REAL NOT NULL,
      dim_scores TEXT,
      reasons TEXT,
      week_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      a_revealed INTEGER DEFAULT 0,
      b_revealed INTEGER DEFAULT 0,
      UNIQUE(user_a, week_key),
      UNIQUE(user_b, week_key)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code);
    CREATE INDEX IF NOT EXISTS idx_matches_week ON matches(week_key);
    CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user_a, user_b);
  `)

  // Seed admin if not exists
  const adminRow = await db.execute('SELECT id FROM users WHERE is_admin = 1')
  if (adminRow.rows.length === 0) {
    // 使用 Web Crypto API（兼容 Edge Runtime）
    const { hashPassword, generateInviteCode } = await import('./security')

    const adminCode = generateInviteCode()
    
    // 管理员邮箱从环境变量读取，避免硬编码泄露
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@jlai.local'
    const adminNickname = process.env.ADMIN_NICKNAME || '管理员'
    
    // 使用 Web Crypto API 生成随机密码
    const pwdBytes = new Uint8Array(12)
    crypto.getRandomValues(pwdBytes)
    const adminPassword = Array.from(pwdBytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    const pwHash = await hashPassword(adminPassword)

    await db.execute({
      sql: `INSERT INTO users (nickname, email, password_hash, invite_code, is_admin, gender, preferred_gender)
            VALUES (?, ?, ?, ?, 1, 'other', 'all')`,
      args: [adminNickname, adminEmail, pwHash, adminCode],
    })

    // Get the admin ID
    const adminResult = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [adminEmail] })
    const adminId = Number(adminResult.rows[0].id)

    for (let i = 0; i < 10; i++) {
      const code = generateInviteCode()
      await db.execute({
        sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
        args: [code, adminId],
      })
    }

    // ⚠️ 管理员初始凭据（请使用 /api/reset-admin 重置或查看日志）
    // 注意：出于安全考虑，密码不会输出到控制台
    // 建议通过环境变量 JWT_SECRET / ENCRYPT_SECRET 配置后使用 /api/auth/change-password 修改
  }

  // Add columns if migrating from old schema (ignore errors)
  const alterStatements = [
    `ALTER TABLE users ADD COLUMN gender TEXT`,
    `ALTER TABLE users ADD COLUMN preferred_gender TEXT`,
    `ALTER TABLE users ADD COLUMN conflict_type TEXT`,
    `ALTER TABLE users ADD COLUMN match_enabled INTEGER DEFAULT 1`,
    `ALTER TABLE matches ADD COLUMN dim_scores TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q21 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q22 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q23 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q24 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q25 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q26 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q27 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q28 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q29 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q30 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q31 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q32 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q33 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q34 TEXT`,
    `ALTER TABLE survey_responses ADD COLUMN q35 TEXT`,
  ]
  for (const sql of alterStatements) {
    try {
      await db.execute(sql)
    } catch (e) {
      /* ignore */
    }
  }

  dbInitialized = true
}
