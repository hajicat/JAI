import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { sanitizeString, sanitizeForStorage } from '@/lib/validation'
import { checkRateLimit, SURVEY_LIMITER } from '@/lib/rate-limit'
import { getWeekKey } from '@/lib/week'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

// Valid answer options for each of the 32 questions (whitelist)
const VALID_OPTIONS: Record<string, string[]> = {
  // A. 安全门槛题 (q1-q8)
  q1: ['会烦，但会先让自己稳住，再说明我现在不方便', '会直接表现出不耐烦，但事后能恢复正常', '很容易把火气撒到当时在场的人身上', '会记很久，之后态度也会变差'],
  q2: ['可以商量，但不是默认义务', '密码无所谓，定位长期共享没必要', '我希望彼此都保留独立隐私', '我想知道对方的，但不太想让对方知道我的'],
  q3: ['一着急就想马上说清楚', '先不说话，缓一缓再谈', '故意说重话，让对方也难受', '故意冷着对方，等TA先来低头'],
  q4: ['先把场面稳住，之后私下说朋友的问题', '先护住朋友情绪，但不会跟着一起攻击别人', '既然是我朋友，我肯定先一起对付外人', '赶紧躲开，别把麻烦沾到我身上'],
  q5: ['会觉得可怜，想办法给点吃的或求助', '有点想帮，但也会担心安全和卫生', '不敢接触，赶紧走开', '会拍个好玩的视频发给朋友吐槽一下'],
  q6: ['尊重，告诉TA需要我时找我', '会有点失落，但能理解', '会追问是不是我做错了什么', '会明显不高兴，觉得这就是在冷落我'],
  q7: ['不做，觉得没必要', '会犹豫，但大概率不想冒这个险', '如果大家都这么干，我也会', '能省事为什么不省，规则本来就是给人绕的'],
  q8: ['先攒钱，或者自己找额外收入', '找平替，等二手或降价', '分期先买了再说', '想办法让父母或对象给我买'],

  // B. 真实性/测谎题 (q9-q14)
  q9: ['从来不会，我一直很正能量', '偶尔会，但知道那只是情绪', '会，而且会在脑子里反复想', '只对真正伤害过我的人才会有'],
  q10: ['太重感情，总是付出太多', '有时脾气急，说话会快', '有时会先顾自己，后知后觉才意识到', '太理性，偶尔显得不够热'],
  q11: ['挺认真，希望系统别乱配', '当成有点意思的测试做做看', '先看看有没有好看的人', '我主要想看看这套东西到底准不准'],
  q12: ['存起来，给之后更重要的事', '买一直想买但确实用得上的东西', '立刻奖励自己或请朋友吃喝玩', '拿去试试高风险投资'],
  q13: ['立刻拿下，机会更重要', '还是按原计划，不买', '借钱/花呗也想先拿下', '先忍住，等二手或以后再说'],
  q14: ['先道歉，再想怎么补救', '先解释清楚不是故意的，再道歉', '先躲一下，等气氛过去', '只要不是故意的，就不用太上纲上线'],

  // C. 价值观题 (q15-q21)
  q15: ['按原计划学', '学完再去汇合', '立刻出门，朋友更重要', '试图把大家都拉到我的节奏里'],
  q16: ['情绪稳定，遇事不乱', '对未来有计划，愿意成长', '有趣松弛，跟TA在一起不累', '很懂我，能给我强烈的陪伴感'],
  q17: ['吵一点，但讲义气', '冷一点，但边界清楚、卫生好', '爱八卦，但肯分担家务', '乱一点，但情绪稳定、好说话'],
  q18: ['先等信息完整，再判断', '很容易共情弱者', '不太关心，跟我关系不大', '忍不住去跟评论区辩论'],
  q19: ['我在想未来，TA在混日子', '我在讲道理，TA只顾发脾气', '我愿意沟通，TA总在逃避', '我看重分寸，TA总觉得无所谓'],
  q20: ['关系里最重要的是稳定和可靠', '关系里最重要的是共同成长', '关系里最重要的是轻松和快乐', '关系里最重要的是浓烈和偏爱'],
  q21: ['合适的关系会让人自然变好', '可以调整习惯，但不能失去自己', '与其改造彼此，不如找更合适的人', '爱我就应该为我改变一些'],

  // D. 互动/冲突题 (q22-q28)
  q22: ['先抱抱/陪着，让TA知道我在', '认真听TA说，陪TA骂两句也行', '帮TA分析问题，给方案', '给TA一点空间，等TA想说再说'],
  q23: ['很多碎片都想立刻分享', '每天固定聊一会儿就挺好', '没什么特别的事不用天天报备', '更喜欢攒到见面时说'],
  q24: ['我来做主安排', '对方安排，我负责配合和体验', '一起商量、分工', '随走随停，不想计划太细'],
  q25: ['想赶紧讲清楚，不想拖', '需要一点时间消化，再谈', '很想确认对方是不是还在乎我', '会忍不住争出个对错'],
  q26: ['我会主动找机会修复关系', '我希望给彼此一点时间，但不会故意拉长', '我通常等对方先来', '谁先低头谁就输了'],
  q27: ['高频沟通和及时回应', '说到做到、稳定靠谱', '行动照顾、生活上很落地', '尊重空间，但关键时候在场'],
  q28: ['主动察觉，来哄我', '问我需不需要聊', '先别打扰，等我整理好', '给我一个实际解决办法'],

  // E. 日常节奏题 (q29-q32)
  q29: ['规律型，白天有安排', '熬夜型，起得晚但有自己的节奏', '看心情，随机应变', '想规律但经常失败'],
  q30: ['很整洁，东西最好归位', '大致整洁就行', '乱一点也能接受', '真的很讨厌打扫，希望别人搞定'],
  q31: ['顺其自然，别算太死', '设共同预算会更安心', '比较偏向清楚AA', '我会期待一方明显多承担一些'],
  q32: ['比较外放，喜欢热闹和新鲜局', '有局会去，但也需要独处', '小圈子就够了，不爱太多社交', '很看对象，跟合拍的人才会打开'],

  // F. 个人画像开放题 (q33-q35) — multi-select 选项白名单
  q33: ['真诚善良', '幽默风趣', '聪明机智', '细心体贴', '独立自主', '乐观开朗', '靠谱负责', '善解人意', '有上进心', '情绪稳定'],
  q34: ['容易焦虑', '有点拖延', '不太会表达', '有时固执', '容易吃醋', '有点懒散', '三分钟热度', '过于敏感', '不善拒绝', '脾气急躁'],
}

// Map answer letter (A/B/C/D) to numeric index for scoring
function answerIndex(questionId: string, answer: string): number {
  const opts = VALID_OPTIONS[questionId]
  if (!opts) return -1
  return opts.indexOf(answer)
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, SURVEY_LIMITER, 'survey')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '提交太频繁' }, { status: 429 })
    }

    // ── 业务层频率限制：每周（自然周）最多修改 3 次问卷 ──
    // 用 settings 表追踪每用户每周提交次数（survey_responses 是 UNIQUE 单行表，无法直接 COUNT）
    const weekKey = getWeekKey()
    const countKey = `survey_week_${decoded.id}_${weekKey}`
    const countResult = await db.execute({
      sql: `SELECT value FROM settings WHERE key = ?`,
      args: [countKey],
    })
    const currentCount = Number((countResult.rows[0] as any)?.value || 0)
    if (currentCount >= 3) {
      return NextResponse.json({ error: '本周问卷已修改3次，请下周再试' }, { status: 429 })
    }

    const answers = await req.json()
    if (typeof answers !== 'object' || answers === null) {
      return NextResponse.json({ error: '数据格式错误' }, { status: 400 })
    }

    const TOTAL_QUESTIONS = 35
    const fields = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => `q${i + 1}`)
    const values: string[] = []

    // Multi-select questions: validate JSON array against whitelist
    const MULTI_SELECT_QUESTIONS = ['q33', 'q34']
    // Free-text questions
    const TEXT_QUESTIONS = ['q35']

    for (const f of fields) {
      const rawVal = answers[f]

      if (TEXT_QUESTIONS.includes(f)) {
        // Free text question — sanitize with HTML entity escape for storage safety
        const val = sanitizeForStorage(typeof rawVal === 'string' ? rawVal : '', 200)
        values.push(val)
      } else if (MULTI_SELECT_QUESTIONS.includes(f)) {
        // Multi-select question — expect JSON array of strings
        if (!rawVal || typeof rawVal !== 'string') {
          values.push('')
          continue
        }
        try {
          const arr = JSON.parse(rawVal)
          if (!Array.isArray(arr)) {
            return NextResponse.json({ error: `第${f.slice(1)}题格式错误，请选择选项` }, { status: 400 })
          }
          if (arr.length > 3) {
            return NextResponse.json({ error: `第${f.slice(1)}题最多选3项` }, { status: 400 })
          }
          const whitelist = VALID_OPTIONS[f]
          for (const item of arr) {
            if (typeof item !== 'string' || !whitelist.includes(item)) {
              return NextResponse.json({ error: `第${f.slice(1)}题包含无效选项` }, { status: 400 })
            }
          }
          values.push(rawVal) // Store as JSON array string
        } catch {
          return NextResponse.json({ error: `第${f.slice(1)}题格式错误` }, { status: 400 })
        }
      } else {
        // Original single-choice question
        const val = sanitizeString(String(rawVal || ''), 200)
        if (val && VALID_OPTIONS[f] && !VALID_OPTIONS[f].includes(val)) {
          return NextResponse.json({ error: `第${f.slice(1)}题答案不合法` }, { status: 400 })
        }
        values.push(val)
      }
    }

    // Check all 35 questions answered
    const unanswered = values.filter(v => !v).length
    if (unanswered > 0) {
      return NextResponse.json({ error: `请回答所有${TOTAL_QUESTIONS}道题目（还有${unanswered}题未答）` }, { status: 400 })
    }

    await db.execute({
      sql: `INSERT OR REPLACE INTO survey_responses (user_id, ${fields.join(', ')}, updated_at)
            VALUES (?, ${values.map(() => '?').join(', ')}, datetime('now'))`,
      args: [decoded.id, ...values],
    })

    await db.execute({
      sql: 'UPDATE users SET survey_completed = 1 WHERE id = ?',
      args: [decoded.id],
    })

    // 递增本周提交计数
    await db.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      args: [countKey, String(currentCount + 1)],
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[survey]', error?.message || error)
    return NextResponse.json({ error: '保存失败，请稍后重试' }, { status: 500 })
  }
}
