// src/app/api/admin/seed-users/route.ts
// 管理员模拟用户管理：批量生成 + 一键删除
//
// POST { count: 100 }  → 生成指定数量的模拟用户（含随机问卷）
// DELETE              → 删除所有模拟用户
//
// 模拟用户标识：email 以 'seed_' 开头，后缀 '@jlai.test'
// 每个用户都有完整的 survey_responses（35题随机作答）

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe, hashPassword, generateInviteCode } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge'

// ──────────────────── 常量 ────────────────────

const SEED_EMAIL_DOMAIN = 'jlai.test'
const SEED_PASSWORD = 'Seed123456' // 所有模拟用户统一密码

// 中文昵称库（男女通用）
const SURNAMES = ['王','李','张','刘','陈','杨','黄','赵','周','吴','徐','孙','马','朱','胡','郭','何','高','林','罗']
const FEMALE_NAMES = ['雨萱','欣怡','子涵','诗涵','梦瑶','雅婷','芷若','思琪','语嫣','紫薇','晓婷','静怡','佳怡','雪儿','婉清','若曦','灵珊','晴柔','凝霜','月华']
const MALE_NAMES   = ['浩然','宇轩','子轩','俊杰','明辉','志强','天翔','博文','嘉伟','浩宇','子豪','晨阳','泽宇','昊然','俊熙','文博','瑞霖','弘毅','逸风','承恩']

// 所有问题的有效选项白名单（与 survey/route.ts 保持一致）
const VALID_OPTIONS: Record<string, string[]> = {
  q1: ['会烦，但会先让自己稳住，再说明我现在不方便', '会直接表现出不耐烦，但事后能恢复正常', '很容易把火气撒到当时在场的人身上', '会记很久，之后态度也会变差'],
  q2: ['可以商量，但不是默认义务', '密码无所谓，定位长期共享没必要', '我希望彼此都保留独立隐私', '我想知道对方的，但不太想让对方知道我的'],
  q3: ['一着急就想马上说清楚', '先不说话，缓一缓再谈', '故意说重话，让对方也难受', '故意冷着对方，等TA先来低头'],
  q4: ['先把场面稳住，之后私下说朋友的问题', '先护住朋友情绪，但不会跟着一起攻击别人', '既然是我朋友，我肯定先一起对付外人', '赶紧躲开，别把麻烦沾到我身上'],
  q5: ['会觉得可怜，想办法给点吃的或求助', '有点想帮，但也会担心安全和卫生', '不敢接触，赶紧走开', '会拍个好玩的视频发给朋友吐槽一下'],
  q6: ['尊重，告诉TA需要时找我', '会有点失落，但能理解', '会追问是不是我做错了什么', '会明显不高兴，觉得这就是在冷落我'],
  q7: ['不做，觉得没必要', '会犹豫，但大概率不想冒这个险', '如果大家都这么干，我也会', '能省事为什么不省，规则本来就是给人绕的'],
  q8: ['先攒钱，或者自己找额外收入', '找平替，等二手或降价', '分期先买了再说', '想办法让父母或对象给我买'],
  q9: ['从来不会，我一直很正能量', '偶尔会，但知道那只是情绪', '会，而且会在脑子里反复想', '只对真正伤害过我的人才会有'],
  q10: ['太重感情，总是付出太多', '有时脾气急，说话会快', '有时会先顾自己，后知后觉才意识到', '太理性，偶尔显得不够热'],
  q11: ['挺认真，希望系统别乱配', '当成有点意思的测试做做看', '先看看有没有好看的人', '我主要想看看这套东西到底准不准'],
  q12: ['存起来，给之后更重要的事', '买一直想买但确实用得上的东西', '立刻奖励自己或请朋友吃喝玩', '拿去试试高风险投资'],
  q13: ['立刻拿下，机会更重要', '还是按原计划，不买', '借钱/花呗也想先拿下', '先忍住，等二手或以后再说'],
  q14: ['先道歉，再想怎么补救', '先解释清楚不是故意的，再道歉', '先躲一下，等气氛过去', '只要不是故意的，就不用太上纲上线'],
  q15: ['按原计划学', '学完再去汇合', '立刻出门，朋友更重要', '试图把大家都拉到我的节奏里'],
  q16: ['情绪稳定，遇事不乱', '对未来有计划，愿意成长', '有趣松弛，跟TA在一起不累', '很懂我，能给我强烈的陪伴感'],
  q17: ['吵一点，但讲义气', '冷一点，但边界清楚、卫生好', '爱八卦，但肯分担家务', '乱一点，但情绪稳定、好说话'],
  q18: ['先等信息完整，再判断', '很容易共情弱者', '不太关心，跟我关系不大', '忍不住去跟评论区辩论'],
  q19: ['我在想未来，TA在混日子', '我在讲道理，TA只顾发脾气', '我愿意沟通，TA总在逃避', '我看重分寸，TA总觉得无所谓'],
  q20: ['关系里最重要的是稳定和可靠', '关系里最重要的是共同成长', '关系里最重要的是轻松和快乐', '关系里最重要的是浓烈和偏爱'],
  q21: ['合适的关系会让人自然变好', '可以调整习惯，但不能失去自己', '与其改造彼此，不如找更合适的人', '爱我就应该为我改变一些'],
  q22: ['先抱抱/陪着，让TA知道我在', '认真听TA说，陪TA骂两句也行', '帮TA分析问题，给方案', '给TA一点空间，等TA想说再说'],
  q23: ['很多碎片都想立刻分享', '每天固定聊一会儿就挺好', '没什么特别的事不用天天报备', '更喜欢攒到见面时说'],
  q24: ['我来做主安排', '对方安排，我负责配合和体验', '一起商量、分工', '随走随停，不想计划太细'],
  q25: ['想赶紧讲清楚，不想拖', '需要一点时间消化，再谈', '很想确认对方是不是还在乎我', '会忍不住争出个对错'],
  q26: ['我会主动找机会修复关系', '我希望给彼此一点时间，但不会故意拉长', '我通常等对方先来', '谁先低头谁就输了'],
  q27: ['高频沟通和及时回应', '说到做到、稳定靠谱', '行动照顾、生活上很落地', '尊重空间，但关键时候在场'],
  q28: ['主动察觉，来哄我', '问我需不需要聊', '先别打扰，等我整理好', '给我一个实际解决办法'],
  q29: ['规律型，白天有安排', '熬夜型，起得晚但有自己的节奏', '看心情，随机应变', '想规律但经常失败'],
  q30: ['很整洁，东西最好归位', '大致整洁就行', '乱一点也能接受', '真的很讨厌打扫，希望别人搞定'],
  q31: ['顺其自然，别算太死', '设共同预算会更安心', '比较偏向清楚AA', '我会期待一方明显多承担一些'],
  q32: ['比较外放，喜欢热闹和新鲜局', '有局会去，但也需要独处', '小圈子就够了，不爱太多社交', '很看对象，跟合拍的人才会打开'],
  // 多选题选项
  q33: ['真诚善良', '幽默风趣', '聪明机智', '细心体贴', '独立自主', '乐观开朗', '靠谱负责', '善解人意', '有上进心', '情绪稳定'],
  q34: ['容易焦虑', '有点拖延', '不太会表达', '有时固执', '容易吃醋', '有点懒散', '三分钟热度', '过于敏感', '不善拒绝', '脾气急躁'],
}

// ──────────────────── 工具函数 ────────────────────

/** 生成随机中文昵称 */
function randomNickname(gender: string): string {
  const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)]
  const namePool = gender === 'female' ? FEMALE_NAMES : MALE_NAMES
  const name = namePool[Math.floor(Math.random() * namePool.length)]
  return surname + name
}

/** 从数组中随机选一个 */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 从数组中随机选 N 个（多选用） */
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(n, arr.length))
}

/** 为一个用户生成完整的随机问卷答案 */
function generateRandomSurvey(): Record<string, string> {
  const answers: Record<string, string> = {}

  // 单选题 q1~q32：从有效选项中随机选一个
  for (let i = 1; i <= 32; i++) {
    const key = `q${i}`
    const opts = VALID_OPTIONS[key]
    if (opts) answers[key] = pick(opts)
  }

  // 多选题 q33（优点）: 随机 2-3 个
  answers.q33 = JSON.stringify(pickN(VALID_OPTIONS.q33, 2 + Math.floor(Math.random() * 2)))

  // 多选题 q34（缺点）: 随机 1-2 个
  answers.q34 = JSON.stringify(pickN(VALID_OPTIONS.q34, 1 + Math.floor(Math.random() * 2)))

  // 自由文本 q35：随机自我介绍模板
  const introTemplates = [
    '喜欢看电影和听音乐，周末一般和朋友出去逛逛。',
    '比较宅，喜欢打游戏和看书，偶尔出去运动。',
    '热爱美食，喜欢尝试各种新餐厅，也是个不错的厨子。',
    '喜欢旅行，去过不少地方，希望以后能一起去更多地方。',
    '平时比较忙，但有空的时候喜欢摄影和画画。',
    '运动达人，每周都会健身或打球，希望你也能一起。',
    '文艺青年，喜欢写东西、看展，对生活有自己独特的理解。',
    '理工科思维，做事有条理，但也希望能遇到有趣的你。',
  ]
  answers.q35 = pick(introTemplates)

  return answers
}

// ──────────────────── POST: 批量生成（优化版：事务批量写入）────────────────────

export async function POST(req: NextRequest) {
  try {
    // 身份验证
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    await initDb()

    const body = await req.json().catch(() => ({}))
    const count = Math.min(Math.max(Number(body.count) || 100, 1), 500) // 限制 1-500 个

    // 获取管理员 ID 作为 invited_by
    const adminRes = await db.execute({
      sql: 'SELECT id FROM users WHERE is_admin = 1 LIMIT 1',
      args: [],
    })
    const adminId = adminRes.rows.length > 0 ? Number((adminRes.rows[0] as any).id) : 1

    // 预哈希密码（所有模拟用户共用，避免重复哈希计算）
    const pwHash = await hashPassword(SEED_PASSWORD)

    // 先查询现有最大 ID，用于生成唯一 email 后缀
    const maxIdResult = await db.execute({ sql: 'SELECT MAX(id) as mid FROM users', args: [] })
    const baseOffset = Number((maxIdResult.rows[0] as any).mid || 0)

    // 预生成所有数据（纯内存操作，无 IO）
    interface SeedUser {
      nickname: string; email: string; gender: string;
      preferredGender: string; inviteCode: string;
      survey: Record<string, string>;
      extraCodes: string[];
    }
    const seedUsers: SeedUser[] = []

    for (let i = 0; i < count; i++) {
      const gender = Math.random() > 0.5 ? 'male' : 'female'
      let preferredGender: string
      if (Math.random() > 0.85) {
        preferredGender = 'all'
      } else {
        preferredGender = gender === 'male' ? 'female' : 'male'
      }

      const uniqueSuffix = baseOffset + i + 1 + Date.now() % 10000
      const extraCodes = [generateInviteCode(), generateInviteCode(), generateInviteCode()]

      seedUsers.push({
        nickname: randomNickname(gender),
        email: `seed_${uniqueSuffix}@${SEED_EMAIL_DOMAIN}`,
        gender,
        preferredGender,
        inviteCode: generateInviteCode(),
        survey: generateRandomSurvey(),
        extraCodes,
      })
    }

    // ── 批量写入：使用事务分组，每批处理一批用户以避免单次请求过大 ──
    const BATCH_SIZE = 20 // 每批 20 个用户
    let totalCreated = 0
    const createdUsers: Array<{ id: number; nickname: string; gender: string }> = []

    for (let batchStart = 0; batchStart < seedUsers.length; batchStart += BATCH_SIZE) {
      const batch = seedUsers.slice(batchStart, batchStart + BATCH_SIZE)
      const sqlStatements: string[] = []
      const sqlArgs: any[][] = []

      for (const u of batch) {
        // INSERT 用户
        sqlStatements.push(
          `INSERT INTO users (nickname, email, password_hash, invite_code, invited_by,
                              is_admin, gender, preferred_gender, survey_completed, match_enabled)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 1)`
        )
        sqlArgs.push([u.nickname, u.email, pwHash, u.inviteCode, adminId, u.gender, u.preferredGender])

        // INSERT 问卷答案
        const fields = Array.from({ length: 35 }, (_, idx) => `q${idx + 1}`)
        const values = fields.map(f => u.survey[f] || '')
        sqlStatements.push(
          `INSERT OR REPLACE INTO survey_responses (user_id, ${fields.join(', ')}, updated_at)
           VALUES ((SELECT id FROM users WHERE email = ?),
                   ${values.map(() => '?').join(', ')}, datetime('now', 'localtime'))`
        )
        sqlArgs.push([u.email, ...values])

        // INSERT 3 个邀请码
        for (const code of u.extraCodes) {
          sqlStatements.push(
            'INSERT INTO invite_codes (code, created_by) VALUES ((SELECT id FROM users WHERE email = ?), ?)'
          )
          sqlArgs.push([u.email, code])
        }
      }

      // 用 executeMultiple 批量执行（一次网络往返搞定整批）
      // 构造带参数的 SQL：libsql 的 executeMultiple 不支持参数，改用逐条执行但用 transaction
      // 回退方案：使用 libsql transaction
      try {
        // 使用事务包裹整批
        await db.execute('BEGIN TRANSACTION')
        for (let s = 0; s < sqlStatements.length; s++) {
          await db.execute({ sql: sqlStatements[s], args: sqlArgs[s] })
        }
        await db.execute('COMMIT')
      } catch (txErr) {
        try { await db.execute('ROLLBACK') } catch (_) { /* ignore */ }
        throw txErr
      }
    }

    // 查询已创建的用户 ID 列表
    const createdResult = await db.execute({
      sql: `SELECT id, nickname, gender FROM users WHERE email LIKE 'seed_%@${SEED_EMAIL_DOMAIN}'
            ORDER BY id DESC LIMIT ?`,
      args: [count],
    })
    for (const row of createdResult.rows) {
      const r = row as any
      createdUsers.unshift({ id: Number(r.id), nickname: r.nickname, gender: r.gender })
    }
    totalCreated = createdUsers.length

    // 统计当前总模拟用户数
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM users WHERE email LIKE 'seed_%@${SEED_EMAIL_DOMAIN}'`,
      args: [],
    })
    const totalSeeds = Number((countResult.rows[0] as any).cnt)

    return NextResponse.json({
      success: true,
      created: totalCreated,
      totalSeeds,
      message: `成功生成 ${totalCreated} 个模拟用户`,
      users: createdUsers.slice(0, 10), // 只返回前10个预览
    })
  } catch (error: any) {
    console.error('[admin/seed-users POST]', error?.message || error)
    return NextResponse.json({ error: '生成模拟用户失败: ' + (error?.message || '未知错误') }, { status: 500 })
  }
}

// ──────────────────── DELETE: 一键删除 ────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    await initDb()

    // 统计要删多少
    const countResult = await db.execute({
      sql: "SELECT COUNT(*) as cnt FROM users WHERE email LIKE 'seed_%@%'",
      args: [],
    })
    const toDeleteCount = Number((countResult.rows[0] as any).cnt)

    if (toDeleteCount === 0) {
      return NextResponse.json({ success: true, deleted: 0, message: '没有需要删除的模拟用户' })
    }

    // 删除模拟用户的问卷数据
    await db.execute({
      sql: `DELETE FROM survey_responses WHERE user_id IN (
              SELECT id FROM users WHERE email LIKE 'seed_%@%'
            )`,
      args: [],
    })

    // 删除模拟用户的邀请码
    await db.execute({
      sql: `DELETE FROM invite_codes WHERE created_by IN (
              SELECT id FROM users WHERE email LIKE 'seed_%@%'
            )`,
      args: [],
    })

    // 删除匹配记录中涉及模拟用户的
    await db.execute({
      sql: `DELETE FROM matches WHERE user_a IN (SELECT id FROM users WHERE email LIKE 'seed_%@%')
             OR user_b IN (SELECT id FROM users WHERE email LIKE 'seed_%@%')`,
      args: [],
    })

    // 最后删除用户
    const delResult = await db.execute({
      sql: "DELETE FROM users WHERE email LIKE 'seed_%@%'",
      args: [],
    })

    const deletedCount = Number(delResult.rowsAffected || toDeleteCount)

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      message: `已删除 ${deletedCount} 个模拟用户及其关联数据（问卷/邀请码/匹配记录）`,
    })
  } catch (error: any) {
    console.error('[admin/seed-users DELETE]', error?.message || error)
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }
}

// ──────────────────── GET: 查询统计 ────────────────────

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    await initDb()

    // 统计模拟用户数量及性别分布
    const statsResult = await db.execute({
      sql: `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN gender='male' THEN 1 ELSE 0 END) as males,
              SUM(CASE WHEN gender='female' THEN 1 ELSE 0 END) as females,
              SUM(CASE WHEN gender='other' THEN 1 ELSE 0 END) as others
             FROM users WHERE email LIKE 'seed_%@%'`,
      args: [],
    })
    const row = statsResult.rows[0] as any

    return NextResponse.json({
      total: Number(row.total || 0),
      males: Number(row.males || 0),
      females: Number(row.females || 0),
      others: Number(row.others || 0),
      password: SEED_PASSWORD,
    })
  } catch (error: any) {
    console.error('[admin/seed-users GET]', error?.message || error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
