import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

// ─────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────

function getWeekKey(): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const diff = now.getTime() - start.getTime()
  const weekNum = Math.ceil(diff / (7 * 24 * 60 * 60 * 1000))
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/** 获取答案的字母索引 A=0 B=1 C=2 D=3，找不到返回 -1 */
function ansIdx(qId: string, answer: string): number {
  const map: Record<string, string[]> = {
    q1: ['会烦，但会先让自己稳住，再说明我现在不方便', '会直接表现出不耐烦，但事后能恢复正常', '很容易把火气撒到当时在场的人身上', '会记很久，之后态度也会变差'],
    q2: ['可以商量，但不是默认义务', '密码无所谓，定位长期共享没必要', '我希望彼此都保留独立隐私', '我想知道对方的，但不太想让对方知道我的'],
    q3: ['一着急就想马上说清楚', '先不说话，缓一缓再谈', '故意说重话，让对方也难受', '故意冷着对方，等TA先来低头'],
    q4: ['先把场面稳住，之后私下说朋友的问题', '先护住朋友情绪，但不会跟着一起攻击别人', '既然是我朋友，我肯定先一起对付外人', '赶紧躲开，别把麻烦沾到我身上'],
    q5: ['会觉得可怜，想办法给点吃的或求助', '有点想帮，但也会担心安全和卫生', '不敢接触，赶紧走开', '会拍个好玩的视频发给朋友吐槽一下'],
    q6: ['尊重，告诉TA需要我时找我', '会有点失落，但能理解', '会追问是不是我做错了什么', '会明显不高兴，觉得这就是在冷落我'],
    q7: ['不做，觉得没必要', '会犹豫，但大概率不想冒这个险', '如果大家都这么干，我也会', '能省事为什么不省，规则本来就是给人绕的'],
    q8: ['先攒钱，或者自己找额外收入', '找平替，等二手或降价', '分期先买了再说', '想办法让父母或对象给我买'],
    // 真实性题
    q9: ['从来不会，我一直很正能量', '偶尔会，但知道那只是情绪', '会，而且会在脑子里反复想', '只对真正伤害过我的人才会有'],
    q10: ['太重感情，总是付出太多', '有时脾气急，说话会快', '有时会先顾自己，后知后觉才意识到', '太理性，偶尔显得不够热'],
    q11: ['挺认真，希望系统别乱配', '当成有点意思的测试做做看', '先看看有没有好看的人', '我主要想看看这套东西到底准不准'],
    q12: ['存起来，给之后更重要的事', '买一直想买但确实用得上的东西', '立刻奖励自己或请朋友吃喝玩', '拿去试试高风险投资'],
    q13: ['立刻拿下，机会更重要', '还是按原计划，不买', '借钱/花呗也想先拿下', '先忍住，等二手或以后再说'],
    q14: ['先道歉，再想怎么补救', '先解释清楚不是故意的，再道歉', '先躲一下，等气氛过去', '只要不是故意的，就不用太上纲上线'],
    // 价值观题
    q15: ['按原计划学', '学完再去汇合', '立刻出门，朋友更重要', '试图把大家都拉到我的节奏里'],
    q16: ['情绪稳定，遇事不乱', '对未来有计划，愿意成长', '有趣松弛，跟TA在一起不累', '很懂我，能给我强烈的陪伴感'],
    q17: ['吵一点，但讲义气', '冷一点，但边界清楚、卫生好', '爱八卦，但肯分担家务', '乱一点，但情绪稳定、好说话'],
    q18: ['先等信息完整，再判断', '很容易共情弱者', '不太关心，跟我关系不大', '忍不住去跟评论区辩论'],
    q19: ['我在想未来，TA在混日子', '我在讲道理，TA只顾发脾气', '我愿意沟通，TA总在逃避', '我看重分寸，TA总觉得无所谓'],
    q20: ['关系里最重要的是稳定和可靠', '关系里最重要的是共同成长', '关系里最重要的是轻松和快乐', '关系里最重要的是浓烈和偏爱'],
    q21: ['合适的关系会让人自然变好', '可以调整习惯，但不能失去自己', '与其改造彼此，不如找更合适的人', '爱我就应该为我改变一些'],
    // 互动/冲突题
    q22: ['先抱抱/陪着，让TA知道我在', '认真听TA说，陪TA骂两句也行', '帮TA分析问题，给方案', '给TA一点空间，等TA想说再说'],
    q23: ['很多碎片都想立刻分享', '每天固定聊一会儿就挺好', '没什么特别的事不用天天报备', '更喜欢攒到见面时说'],
    q24: ['我来做主安排', '对方安排，我负责配合和体验', '一起商量、分工', '随走随停，不想计划太细'],
    q25: ['想赶紧讲清楚，不想拖', '需要一点时间消化，再谈', '很想确认对方是不是还在乎我', '会忍不住争出个对错'],
    q26: ['我会主动找机会修复关系', '我希望给彼此一点时间，但不会故意拉长', '我通常等对方先来', '谁先低头谁就输了'],
    q27: ['高频沟通和及时回应', '说到做到、稳定靠谱', '行动照顾、生活上很落地', '尊重空间，但关键时候在场'],
    q28: ['主动察觉，来哄我', '问我需不需要聊', '先别打扰，等我整理好', '给我一个实际解决办法'],
    // 日常节奏题
    q29: ['规律型，白天有安排', '熬夜型，起得晚但有自己的节奏', '看心情，随机应变', '想规律但经常失败'],
    q30: ['很整洁，东西最好归位', '大致整洁就行', '乱一点也能接受', '真的很讨厌打扫，希望别人搞定'],
    q31: ['顺其自然，别算太死', '设共同预算会更安心', '比较偏向清楚AA', '我会期待一方明显多承担一些'],
    q32: ['比较外放，喜欢热闹和新鲜局', '有局会去，但也需要独处', '小圈子就够了，不爱太多社交', '很看对象，跟合拍的人才会打开'],
  }
  return (map[qId] || []).indexOf(answer)
}

// ─────────────────────────────────────────────
//  一、安全筛查算法
// ─────────────────────────────────────────────

interface SafetyResult {
  level: 'blocked' | 'restricted' | 'normal'
  riskScore: number
  hardBlock: boolean
}

function calcSafety(u: any): SafetyResult {
  let risk = 0
  let hardBlock = false

  const a1 = ansIdx('q1', u.q1), a2 = ansIdx('q2', u.q2), a3 = ansIdx('q3', u.q3)
  const a4 = ansIdx('q4', u.q4), a5 = ansIdx('q5', u.q5), a6 = ansIdx('q6', u.q6)
  const a7 = ansIdx('q7', u.q7), a8 = ansIdx('q8', u.q8)
  const a21 = ansIdx('q21', u.q21)

  // 严重红旗 +3
  if (a2 === 3) risk += 3   // D: 双标控制
  if (a3 === 2) risk += 3   // C: 故意用狠话伤人
  if (a4 === 2) risk += 3   // C: 帮派围攻
  if (a5 === 3) risk += 3   // D: 痛苦娱乐化
  if (a8 === 3) risk += 3   // D: 索取型
  if (a21 === 3) risk += 3  // D: 爱=你该为我改变

  // 中度红旗 +2
  if (a1 === 2) risk += 2   // C: 明显迁怒
  if (a1 === 3) risk += 2   // D: 长期记仇
  if (a3 === 3) risk += 2   // D: 冷暴力式僵持
  if (a6 === 3) risk += 2   // D: 把边界解读成冷落
  if (a7 === 3) risk += 2   // D: 蔑视规则

  // 轻度风险 +1
  if (a6 === 2) risk += 1   // C: 会追问是不是我做错了
  if (a7 === 2) risk += 1   // C: 大家这么干我也干
  if (a8 === 2) risk += 1   // C: 分期先买

  // 组合封禁
  if ((a2 === 3) && (a21 === 3)) hardBlock = true          // 双标控制 + 索取式关系观
  if ((a1 >= 2) && (a3 === 2)) hardBlock = true              // 迁怒 + 语言攻击
  if ((a3 === 3) && (ansIdx('q26', u.q26) === 3)) hardBlock = true  // 冷暴力 + 权力博弈
  if ((a4 === 2) && (a7 === 3)) hardBlock = true             // 围攻 + 规则蔑视
  if ((a5 === 3) && (ansIdx('q14', u.q14) >= 2)) hardBlock = true  // 低共情 + 低责任承担

  let level: SafetyResult['level'] = 'normal'
  if (hardBlock || risk >= 6) level = 'blocked'
  else if (risk >= 3) level = 'restricted'

  return { level, riskScore: risk, hardBlock }
}

// ─────────────────────────────────────────────
//  二、真实性算法
// ─────────────────────────────────────────────

function calcTruth(u: any): number {
  let score = 1.0

  const a9 = ansIdx('q9', u.q9), a10 = ansIdx('q10', u.q10)
  const a11 = ansIdx('q11', u.q11), a12 = ansIdx('q12', u.q12)
  const a13 = ansIdx('q13', u.q13), a6 = ansIdx('q6', u.q6)
  const a26 = ansIdx('q26', u.q26), a14 = ansIdx('q14', u.q14)
  const a3 = ansIdx('q3', u.q3)

  // 过于完美减分
  if (a9 === 0) score -= 0.12  // 从来没有阴暗想法
  if (a10 === 0) score -= 0.10  // "太重感情"经典伪缺点
  if (a11 >= 1 && a11 <= 2) score -= 0.12  // 投入度偏低

  // 交叉矛盾惩罚
  if (a12 === 0 && a13 === 0) score -= 0.18  // 说存钱却立刻花光
  if (a6 === 0 && a26 === 3) score -= 0.12     // 口头尊重边界，实际玩权力游戏
  if (a14 === 0 && a3 === 2) score -= 0.08      // 一边说负责，一边故意伤人

  // "完美模板人设"惩罚：统计选了最体面答案(A)的数量
  const perfectAnswers = [u.q1, u.q4, u.q5, u.q6, u.q8, u.q12,
    u.q14, u.q15, u.q16, u.q22, u.q27, u.q29, u.q30]
  const perfectCount = perfectAnswers.filter((a: string) => {
    const idx = ansIdx('q1', a) // just to check pattern; use generic approach
    return false // handled below by direct index checks per question
  }).length

  // Count actual "most socially desirable" answers (typically option A for most questions)
  const desirableA = [
    ansIdx('q1', u.q1) === 0,  // 稳住再说明
    ansIdx('q4', u.q4) === 0,  // 场面稳住
    ansIdx('q5', u.q5) === 0,  // 觉得可怜给吃的
    ansIdx('q6', u.q6) === 0,  // 尊重边界
    ansIdx('q8', u.q8) === 0,  // 攒钱
    ansIdx('q12', u.q12) === 0, // 存起来
    ansIdx('q14', u.q14) === 0, // 先道歉
    ansIdx('q15', u.q15) === 0, // 按原计划学
    ansIdx('q16', u.q16) === 0, // 情绪稳定
    ansIdx('q22', u.q22) === 0, // 先抱抱
    ansIdx('q27', u.q27) === 0, // 高频沟通
    ansIdx('q29', u.q29) === 0, // 规律型
    ansIdx('q30', u.q30) === 0, // 很整洁
  ].filter(Boolean).length

  if (desirableA >= 10) score -= 0.08
  if (desirableA >= 14) score -= 0.12

  return Math.max(0.55, Math.min(1.0, score))
}

// ─────────────────────────────────────────────
//  三、匹配算法 — 同频题距离计分
// ─────────────────────────────────────────────

function sameFreqScore(idxA: number, idxB: number): number {
  if (idxA < 0 || idxB < 0) return 50
  const d = Math.abs(idxA - idxB)
  if (d === 0) return 100
  if (d === 1) return 80
  if (d === 2) return 45
  return 10
}

// ─────────────────────────────────────────────
//  四、匹配算法 — 互补题矩阵计分
// ─────────────────────────────────────────────

/** Q22 安抚方式 */
function scoreQ22(a: number, b: number): number {
  // 0=抱抱陪  1=听+陪骂  2=给方案  3=给空间
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 78, 1: 88, 2: 72, 3: 65 },
    '1': { 0: 88, 1: 75, 2: 70, 3: 68 },
    '2': { 0: 72, 1: 70, 2: 60, 3: 75 },  // 方案+空间 还行
    '3': { 0: 65, 1: 68, 2: 75, 3: 58 },  // 都要空间=疏离
  }
  return m[String(a)]?.[b] ?? 50
}

/** Q24 旅行分工 */
function scoreQ24(a: number, b: number): number {
  // 0=我做主  1=对方安排  2=一起商量  3=随走随停
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 40, 1: 100, 2: 78, 3: 35 },
    '1': { 0: 100, 1: 55, 2: 75, 3: 38 },
    '2': { 0: 78, 1: 75, 2: 92, 3: 72 },
    '3': { 0: 35, 1: 38, 2: 72, 3: 60 },
  }
  return m[String(a)]?.[b] ?? 50
}

/** Q25 冲突节奏 */
function scoreQ25(a: number, b: number): number {
  // 0=赶紧讲清  1=需要时间  2=确认在乎  3=争对错
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 68, 1: 90, 2: 62, 3: 32 },
    '1': { 0: 90, 1: 85, 2: 70, 3: 38 },
    '2': { 0: 62, 1: 70, 2: 52, 3: 28 },
    '3': { 0: 32, 1: 38, 2: 28, 3: 20 },
  }
  return m[String(a)]?.[b] ?? 50
}

/** Q26 修复能力 — 最核心的灾难组合题 */
function scoreQ26(a: number, b: number): number {
  // 0=主动修  1=给点时间  2=等对方  3=谁低头谁输
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 92, 1: 96, 2: 72, 3: 0 },
    '1': { 0: 96, 1: 85, 2: 58, 3: 0 },
    '2': { 0: 72, 1: 58, 2: 18, 3: 0 },
    '3': { 0: 0,  1: 0,  2: 0,  3: 0 },
  }
  return m[String(a)]?.[b] ?? 0
}

/** Q28 不开心时的需求 */
function scoreQ28(a: number, b: number): number {
  // 0=来哄我  1=问我需不需要  2=别打扰  3=给办法
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 70, 1: 85, 2: 45, 3: 72 },
    '1': { 0: 85, 1: 80, 2: 55, 3: 82 },
    '2': { 0: 45, 1: 55, 2: 88, 3: 60 },
    '3': { 0: 72, 1: 82, 2: 60, 3: 76 },
  }
  return m[String(a)]?.[b] ?? 50
}

// ─────────────────────────────────────────────
//  五、完整匹配引擎
// ─────────────────────────────────────────────

interface MatchResult {
  score: number
  dimScores: Array<{ name: string; score: number; compatible: boolean }>
  reasons: string[]
  safetyLevel: string
  truthScore: number
}

/**
 * 题目分类定义：
 * - 安全门槛题 (1-8, 21)：不参与配对加分，仅用于安全筛查
 * - 真实性题 (9-14)：不参与配对加分，用于计算真实性系数
 * - 同频值题 (15-20, 23, 27, 29-32)：越接近越好
 * - 互补题 (22, 24, 25, 28)：特定组合更好
 * - 互补核心题 (26)：修复能力，含灾难组合扣分
 */
const SAME_FREQ_QUESTIONS = ['q15','q16','q17','q18','q19','q20','q23','q27','q29','q30','q31','q32']
const COMP_QUESTIONS = [
  { id: 'q22', fn: scoreQ22, name: '安抚方式' },
  { id: 'q24', fn: scoreQ24, name: '角色分工' },
  { id: 'q25', fn: scoreQ25, name: '冲突节奏' },
  { id: 'q28', fn: scoreQ28, name: '需求表达' },
]

function calculateMatch(a: any, b: any): MatchResult {
  // 1. 安全筛查
  const safetyA = calcSafety(a)
  const safetyB = calcSafety(b)
  if (safetyA.level === 'blocked' || safetyB.level === 'blocked') {
    return { score: 0, dimScores: [], reasons: ['安全筛查未通过'], safetyLevel: 'blocked', truthScore: 0 }
  }

  // 2. 真实性计算
  const truthA = calcTruth(a)
  const truthB = calcTruth(b)

  // 3. 同频题评分
  let valueScores: number[] = []
  for (const q of ['q15','q16','q18','q19','q20']) {
    valueScores.push(sameFreqScore(ansIdx(q, a[q]), ansIdx(q, b[q])))
  }

  let interactionScores: number[] = []
  // 同频互动题
  interactionScores.push(sameFreqScore(ansIdx('q23', a.q23), ansIdx('q23', b.q23)))
  interactionScores.push(sameFreqScore(ansIdx('q27', a.q27), ansIdx('q27', b.q27)))

  // 互补互动题
  for (const cq of COMP_QUESTIONS) {
    interactionScores.push(cq.fn(ansIdx(cq.id, a[cq.id]), ansIdx(cq.id, b[cq.id])))
  }
  // Q26 修复能力（核心）
  interactionScores.push(scoreQ26(ansIdx('q26', a.q26), ansIdx('q26', b.q26)))

  let dailyScores: number[] = []
  for (const q of ['q29','q30','q31','q32']) {
    dailyScores.push(sameFreqScore(ansIdx(q, a[q]), ansIdx(q, b[q])))
  }

  // 平均分
  const avgValue = valueScores.length > 0 ? valueScores.reduce((s,v)=>s+v,0)/valueScores.length : 50
  const avgInteraction = interactionScores.length > 0 ? interactionScores.reduce((s,v)=>s+v,0)/interactionScores.length : 50
  const avgDaily = dailyScores.length > 0 ? dailyScores.reduce((s,v)=>s+v,0)/dailyScores.length : 50

  // 4. 灾难组合惩罚
  let disasterPenalty = 0
  const q26A = ansIdx('q26', a.q26), q26B = ansIdx('q26', b.q26)
  const q23A = ansIdx('q23', a.q23), q23B = ansIdx('q23', b.q23)
  const q24A = ansIdx('q24', a.q24), q24B = ansIdx('q24', b.q24)
  const q25A = ansIdx('q25', a.q25), q25B = ansIdx('q25', b.q25)

  // 都等对方低头 → 大扣
  if ((q26A >= 2 && q26B >= 2)) disasterPenalty += 25
  // 一个高频粘人一个极度抽离
  if ((q23A === 0 && q23B >= 2) || (q23B === 0 && q23A >= 2)) disasterPenalty += 10
  // 强主导 × 强争对错
  if ((q24A === 0 && q25B === 3) || (q24B === 0 && q25A === 3)) disasterPenalty += 12

  // 5. 加权总分（价值观35% + 互动冲突45% + 日常20%）
  const baseScore = avgValue * 0.35 + avgInteraction * 0.45 + avgDaily * 0.20

  // 6. 真实性和风险系数
  const confidenceFactor = Math.min(truthA, truthB)
  const riskFactor = (safetyA.level === 'restricted' || safetyB.level === 'restricted') ? 0.82 : 1.0

  let finalScore = (baseScore - disasterPenalty) * confidenceFactor * riskFactor
  finalScore = Math.max(0, Math.min(99, Math.round(finalScore)))

  // 7. 维度分数
  const dimScores = [
    { name: '价值观', score: Math.round(avgValue), compatible: avgValue >= 70 },
    { name: '互动模式', score: Math.round(avgInteraction), compatible: avgInteraction >= 70 },
    { name: '日常节奏', score: Math.round(avgDaily), compatible: avgDaily >= 70 },
  ]

  // 8. 匹配文案生成
  const reasons = generateReasons(a, b, finalScore, avgValue, avgInteraction, avgDaily, q26A, q26B, q24A, q24B, q23A, q23B)

  const worstSafety = safetyA.riskScore > safetyB.riskScore ? safetyA.level : safetyB.level
  const minTruth = Math.min(truthA, truthB)

  return { score: finalScore, dimScores, reasons, safetyLevel: worstSafety, truthScore: Math.round(minTruth * 100) / 100 }
}

// ─────────────────────────────────────────────
//  六、匹配文案生成器（关系语言风格）
// ─────────────────────────────────────────────

function generateReasons(
  a: any, b: any, finalScore: number,
  avgValue: number, avgInteraction: number, avgDaily: number,
  q26A: number, q26B: number, q24A: number, q24B: number,
  q23A: number, q23B: number
): string[] {
  const reasons: string[] = []

  // 修复能力描述
  if (q26A <= 1 && q26B <= 1) {
    reasons.push('你们都不是把关系当成输赢的人。遇到问题时一方愿意主动修复，另一方也愿意接住，这种组合很容易把争执变成沟通。')
  } else if (q26A !== q26B && q26A < 2 && q26B < 2) {
    reasons.push('在处理矛盾时，你们的节奏形成了一种自然的配合——一个更愿意先开口，另一个擅长冷静后再谈。')
  }

  // 日常相处描述
  if (avgDaily >= 75) {
    if (q23A >= 0 && q23B >= 0 && Math.abs(q23A - q23B) <= 1) {
      reasons.push('在日常生活里，你们对陪伴频率和生活节奏的期待也比较接近，不容易出现"我以为"和"你怎么又"的落差。')
    } else {
      reasons.push('你们在日常生活的节奏上有不错的默契。')
    }
  }

  // 旅行/分工描述
  if (q24A === 0 && q24B === 1) {
    reasons.push('一个擅长安排规划，另一个愿意配合享受，这种搭配出门旅行会很顺畅。')
  } else if (q24B === 0 && q24A === 1) {
    reasons.push('一个擅长安排规划，另一个愿意配合享受，这种搭配出门旅行会很顺畅。')
  } else if (q24A === 2 && q24B === 2) {
    reasons.push('你们都倾向于商量着来，这种成熟的相处方式不容易产生权力拉扯。')
  }

  // 价值观描述
  if (avgValue >= 72) {
    const vMatches = ['q15','q16','q18','q19','q20'].filter(q => a[q] && b[q] && a[q] === b[q])
    if (vMatches.length >= 3) {
      reasons.push('你们在人生优先级和价值选择上高度一致，这是关系长期稳定的基石。')
    }
  }

  // 总评
  if (finalScore >= 86) {
    reasons.push('这是一组非常难得的匹配——不只是"聊得来"，而是真正有可能走得远的关系底色。')
  } else if (finalScore >= 76) {
    reasons.push('整体来看是值得认真了解的对象，建议多聊聊彼此的生活方式和处事节奏。')
  }

  return reasons.slice(0, 4)
}

// ─────────────────────────────────────────────
//  性别兼容检查
// ─────────────────────────────────────────────

function genderCompatible(userA: any, userB: any): boolean {
  const aGender = userA.gender
  const bGender = userB.gender
  const aPref = userA.preferred_gender
  const bPref = userB.preferred_gender
  const aWantsB = aPref === 'all' || aPref === bGender
  const bWantsA = bPref === 'all' || bPref === aGender
  return aWantsB && bWantsA
}

// ─────────────────────────────────────────────
//  API 入口
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyToken(token)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const db = getDb()
    const weekKey = getWeekKey()

    const usersResult = await db.execute({
      sql: `SELECT u.id, u.gender, u.preferred_gender,
                   s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                   s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                   s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                   s.q31,s.q32
            FROM users u
            JOIN survey_responses s ON u.id = s.user_id
            WHERE u.survey_completed = 1 AND u.match_enabled = 1
              AND u.id NOT IN (
                SELECT user_a FROM matches WHERE week_key = ?
                UNION
                SELECT user_b FROM matches WHERE week_key = ?
              )`,
      args: [weekKey, weekKey],
    })

    const users = usersResult.rows as any[]

    if (users.length < 2) {
      return NextResponse.json({ error: '参与人数不足，至少需要2人', count: users.length })
    }

    // Pre-calculate safety and filter out blocked users
    const safeUsers: Array<{ user: any; safety: SafetyResult; truth: number }> = []
    for (const u of users) {
      const safety = calcSafety(u)
      const truth = calcTruth(u)
      if (safety.level === 'blocked') continue
      safeUsers.push({ user: u, safety, truth })
    }

    if (safeUsers.length < 2) {
      return NextResponse.json({ error: '安全筛选后参与人数不足（部分用户被安全门槛拦截）', count: users.length })
    }

    const matches: any[] = []
    const matched = new Set<number>()
    const shuffled = [...safeUsers].sort(() => Math.random() - 0.5)

    const MATCH_THRESHOLD = 76
    const SAFE_THRESHOLD = 68

    for (let i = 0; i < shuffled.length; i++) {
      if (matched.has(Number(shuffled[i].user.id))) continue

      let bestMatch: typeof shuffled[0] | null = null
      let bestScore = 0
      let bestResult: MatchResult | null = null

      for (let j = i + 1; j < shuffled.length; j++) {
        if (matched.has(Number(shuffled[j].user.id))) continue
        if (!genderCompatible(shuffled[i].user, shuffled[j].user)) continue

        const result = calculateMatch(shuffled[i].user, shuffled[j].user)
        if (result.score > bestScore) {
          bestScore = result.score
          bestMatch = shuffled[j]
          bestResult = result
        }
      }

      if (bestMatch && bestResult && bestScore >= MATCH_THRESHOLD) {
        await db.execute({
          sql: `INSERT INTO matches (user_a, user_b, score, dim_scores, reasons, week_key)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            Number(shuffled[i].user.id),
            Number(bestMatch.user.id),
            bestScore,
            JSON.stringify(bestResult.dimScores),
            JSON.stringify(bestResult.reasons),
            weekKey,
          ],
        })
        matched.add(Number(shuffled[i].user.id))
        matched.add(Number(bestMatch.user.id))
        matches.push({
          userA: shuffled[i].user.id,
          userB: bestMatch.user.id,
          score: bestScore,
          dimScores: bestResult.dimScores,
          reasons: bestResult.reasons,
          safetyLevel: bestResult.safetyLevel,
          truthScore: bestResult.truthScore,
        })
      }
    }

    return NextResponse.json({
      success: true,
      weekKey,
      matchedPairs: matches.length,
      unmatchedUsers: shuffled.length - matched.size,
      totalEligible: users.length,
      safePoolSize: safeUsers.length,
    })
  } catch (error: any) {
    console.error('[admin/match]', error?.message || error)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
