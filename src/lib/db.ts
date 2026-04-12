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
  catch (err) { initPromise = null; throw err } // 失败后允许重试
}

// 当前 schema 版本：
// 1 = 基础建表（executeMultiple 内的表 + 索引均已包含）
// 迁移到更高版本时，只运行增量 ALTER TABLE，完成后更新版本号
const CURRENT_SCHEMA_VERSION = 1

async function doInit(): Promise<void> {
  const db = getDb()

  // ── 第1次 DB 往返：建表 + 索引（幂等，重复执行无影响）──
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
      created_at TEXT DEFAULT (datetime('now')),
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
      created_at TEXT DEFAULT (datetime('now'))
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
      updated_at TEXT DEFAULT (datetime('now')),
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
      created_at TEXT DEFAULT (datetime('now')),
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

    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code);
    CREATE INDEX IF NOT EXISTS idx_matches_week ON matches(week_key);
    CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user_a, user_b);
    CREATE INDEX IF NOT EXISTS idx_survey_user ON survey_responses(user_id);
    CREATE INDEX IF NOT EXISTS idx_invite_codes_creator ON invite_codes(created_by);
    CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
    CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON verification_codes(expires_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
  `)

  // ── 第2次 DB 往返：检查 schema 版本 & admin 种子状态（settings 表）──
  const versionRow = await db.execute({
    sql: `SELECT value FROM settings WHERE key = 'db_schema_version'`,
    args: [],
  })
  const adminSeededRow = await db.execute({
    sql: `SELECT value FROM settings WHERE key = 'admin_seeded'`,
    args: [],
  })
  const currentVersion = Number(versionRow.rows[0]?.value ?? 0)
  const adminAlreadySeeded = adminSeededRow.rows.length > 0

  // ── Schema 迁移（增量，只在版本低于当前时才执行）──
  // 版本 1→2: ALTER TABLE users 添加新列（users 表早期没有这些列的历史数据需要迁移）
  if (currentVersion < 1) {
    const userAlters = [
      `ALTER TABLE users ADD COLUMN gender TEXT`,
      `ALTER TABLE users ADD COLUMN preferred_gender TEXT`,
      `ALTER TABLE users ADD COLUMN conflict_type TEXT`,
      `ALTER TABLE users ADD COLUMN match_enabled INTEGER DEFAULT 1`,
      `ALTER TABLE users ADD COLUMN password_changed_at TEXT`,
      `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`,
    ]
    const surveyAlters: string[] = []
    for (let i = 21; i <= 35; i++) {
      surveyAlters.push(`ALTER TABLE survey_responses ADD COLUMN q${i} TEXT`)
    }
    for (const sql of [...userAlters, `ALTER TABLE matches ADD COLUMN dim_scores TEXT`, ...surveyAlters]) {
      try { await db.execute(sql) } catch (_) { /* 列已存在则忽略 */ }
    }
    await db.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('db_schema_version', ?, datetime('now'))`,
      args: [String(CURRENT_SCHEMA_VERSION)],
    })
  }

  // ── 管理员种子（仅首次运行）──
  if (!adminAlreadySeeded) {
    const { hashPassword, generateInviteCode } = await import('./security')

    const adminCode = generateInviteCode()
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@jlai.local'
    const adminNickname = process.env.ADMIN_NICKNAME || '管理员'

    const pwdBytes = new Uint8Array(12)
    crypto.getRandomValues(pwdBytes)
    const adminPassword = Array.from(pwdBytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    const pwHash = await hashPassword(adminPassword)

    await db.execute({
      sql: `INSERT INTO users (nickname, email, password_hash, invite_code, is_admin, gender, preferred_gender)
            VALUES (?, ?, ?, ?, 1, 'other', 'all')`,
      args: [adminNickname, adminEmail, pwHash, adminCode],
    })

    const adminResult = await db.execute({
      sql: `SELECT id FROM users WHERE email = ?`,
      args: [adminEmail],
    })
    const adminId = Number(adminResult.rows[0].id)

    const codeStmts: Array<{ sql: string; args: unknown[] }> = []
    for (let i = 0; i < 10; i++) {
      codeStmts.push({
        sql: `INSERT INTO invite_codes (code, created_by) VALUES (?, ?)`,
        args: [generateInviteCode(), adminId],
      })
    }
    try { await db.batch(codeStmts) } catch (_) {
      for (const stmt of codeStmts) {
        try { await db.execute(stmt) } catch (__) { /* ignore */ }
      }
    }

    const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
    if (isDev) {
      console.log(`\n[INIT] 🔐 管理员账号已创建:`)
      console.log(`  邮箱: ${adminEmail}`)
      console.log(`  密码: ${adminPassword}`)
      console.log(`  邀请码: ${adminCode}`)
      console.log(`  ⚠️  请立即登录并修改密码！\n`)
    } else {
      console.warn(`[INIT] 管理员已创建 (${adminEmail})，生产环境密码不输出到日志。如需重置请通过数据库直接操作。`)
    }

    // 标记已执行，后续请求跳过整个 admin 种子块
    await db.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('admin_seeded', '1', datetime('now'))`,
      args: [],
    })
  }

  dbInitialized = true
}
