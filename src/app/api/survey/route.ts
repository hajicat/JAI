import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { sanitizeString } from '@/lib/validation'
import { checkRateLimit, SURVEY_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

// Valid answer options for each question (whitelist)
const VALID_OPTIONS: Record<string, string[]> = {
  q1: ['事事有回应', '我的后盾与港湾', '自由的牵挂', '共同进步的战友'],
  q2: ['回复速度', '对方遇到事情想到我的顺序', '对方在别人面前提起我的方式', '相处时的自然程度'],
  q3: ['我会冷静观察', '我会直接问清楚', '我会通过行动试探', '我会自己消化'],
  q4: ['绝不原谅', '看情况，可以谈', '感情上难接受但理性上理解', '人非圣贤，能改就好'],
  q5: ['立即回复，有空就聊', '有空时统一回复', '看内容重要程度', '不紧急的事攒到晚上聊'],
  q6: ['一起旅行', '深度聊天', '一起完成某件事', '安静待在一起'],
  q7: ['海豚型 — 逃避冲突，冷静后处理', '猫型 — 敏感焦虑，需要反复确认', '犬型 — 讨好对方，先低头', '鲨鱼型 — 强势进攻，必须赢'],
  q8: ['「你怎么又这样」', '「我想我们需要谈谈这个问题」', '沉默不说话', '用幽默带过去'],
  q9: ['我希望TA听我说完', '我希望TA给我一个解决方案', '我希望TA抱着我', '我希望TA给我独处空间'],
  q10: ['必须当天解决', '冷静一两天再谈', '等双方都准备好', '时间会冲淡一切'],
  q11: ['主动分享自己的一切', '分享有趣的事', '只在对方问的时候说', '有些事不想说'],
  q12: ['需要频繁说', '重要时刻说就够了', '用行动代替', '不太会表达，但心里有'],
  q13: ['被理解', '被需要', '被欣赏', '被信任'],
  q14: ['「我们的未来」', '「你今天过得怎样」', '「我看到了这个想到你」', '「我爱你」'],
  q15: ['三观一致很重要，差太多不行', '可以有差异，但核心价值要一致', '差异不是问题，尊重就好', '三观可以磨合'],
  q16: ['自由高于一切', '稳定高于一切', '成长高于一切', '快乐高于一切'],
  q17: ['门当户对有一定道理', '爱情可以克服一切差异', '关键是两个人愿意一起努力', '家庭背景会影响但不决定'],
  q18: ['我愿意为TA改变很多', '我会保持自我，小妥协可以', '改变应该自然发生', '好的关系不需要改变'],
  q19: ['需要TA鼓励我', '需要TA给我空间', '需要TA陪我一起面对', '需要TA帮我分析'],
  q20: ['完全同步最好', '有各自节奏也行', '一方快一方慢很正常', '不确定'],
  q21: ['经常沟通金钱观念', '各自管各自的', '一个人统一管理', 'AA制'],
  q22: ['非常介意', '有点在意', '不太在意', '完全不介意'],
  q23: ['生', '熟', '半生不熟', '看心情'],
  q24: ['大男子/大女子主义', '势均力敌', '我喜欢被照顾', '我喜欢照顾人'],
  q25: ['早睡早起', '晚睡晚起', '不规律', '规律但偏夜猫子'],
  q26: ['出门探索', '宅家休息', '朋友聚会', '学习/搞副业'],
  q27: ['必须整洁', '大致整洁', '有点乱但自己知道', '看心情'],
  q28: ['规律三餐', '想吃就吃', '注重健康', '美食探索家'],
  q29: ['很重要，直接影响相处', '有些影响', '影响不大', '完全不重要'],
  q30: ['完全不看', '偶尔看', '经常看', '随时刷'],
  q31: ['直接说', '发消息', '暗示', '写信/长文'],
}

function getConflictType(q7Answer: string): string {
  if (q7Answer.includes('海豚')) return 'dolphin'
  if (q7Answer.includes('猫')) return 'cat'
  if (q7Answer.includes('犬')) return 'dog'
  if (q7Answer.includes('鲨鱼')) return 'shark'
  return 'unknown'
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = checkRateLimit(ip, SURVEY_LIMITER, 'survey')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '提交太频繁' }, { status: 429 })
    }

    const answers = await req.json()
    if (typeof answers !== 'object' || answers === null) {
      return NextResponse.json({ error: '数据格式错误' }, { status: 400 })
    }

    const db = getDb()

    const fields = Array.from({ length: 31 }, (_, i) => `q${i + 1}`)
    const values: string[] = []

    for (const f of fields) {
      const val = sanitizeString(String(answers[f] || ''), 200)
      if (val && VALID_OPTIONS[f] && !VALID_OPTIONS[f].includes(val)) {
        return NextResponse.json({ error: `第${f.slice(1)}题答案不合法` }, { status: 400 })
      }
      values.push(val)
    }

    // Check all 31 questions answered
    const unanswered = values.filter(v => !v).length
    if (unanswered > 0) {
      return NextResponse.json({ error: `请回答所有31道题目（还有${unanswered}题未答）` }, { status: 400 })
    }

    const conflictType = getConflictType(values[6])

    await db.execute({
      sql: `INSERT OR REPLACE INTO survey_responses (user_id, ${fields.join(', ')}, updated_at)
            VALUES (?, ${values.map(() => '?').join(', ')}, datetime('now', 'localtime'))`,
      args: [decoded.id, ...values],
    })

    await db.execute({
      sql: 'UPDATE users SET survey_completed = 1, conflict_type = ? WHERE id = ?',
      args: [conflictType, decoded.id],
    })

    return NextResponse.json({ success: true, conflictType })
  } catch (error: any) {
    console.error('[survey]', error?.message || error)
    return NextResponse.json({ error: '保存失败，请稍后重试' }, { status: 500 })
  }
}
