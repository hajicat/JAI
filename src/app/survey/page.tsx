'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const QUESTIONS = [
  // === 安全联结 (q1-q6) ===
  { dim: '安全联结', q: '你最认同哪种「爱的安全感」来源？', options: ['事事有回应', '我的后盾与港湾', '自由的牵挂', '共同进步的战友'] },
  { dim: '安全联结', q: '以下哪个瞬间最让你感到「被爱」？', options: ['回复速度', '对方遇到事情想到我的顺序', '对方在别人面前提起我的方式', '相处时的自然程度'] },
  { dim: '安全联结', q: '当感觉对方在疏远你时，你通常会？', options: ['我会冷静观察', '我会直接问清楚', '我会通过行动试探', '我会自己消化'] },
  { dim: '安全联结', q: '你对「过去的感情经历」的态度是？', options: ['绝不原谅', '看情况，可以谈', '感情上难接受但理性上理解', '人非圣贤，能改就好'] },
  { dim: '安全联结', q: '你的回复速度通常是？', options: ['立即回复，有空就聊', '有空时统一回复', '看内容重要程度', '不紧急的事攒到晚上聊'] },
  { dim: '安全联结', q: '和喜欢的人在一起时你更享受？', options: ['一起旅行', '深度聊天', '一起完成某件事', '安静待在一起'] },
  // === 互动模式 (q7-q12) ===
  { dim: '互动模式', q: '面对冲突时，你更像哪种动物？', options: ['海豚型 — 逃避冲突，冷静后处理', '猫型 — 敏感焦虑，需要反复确认', '犬型 — 讨好对方，先低头', '鲨鱼型 — 强势进攻，必须赢'] },
  { dim: '互动模式', q: '吵架时你最容易脱口而出的话是？', options: ['「你怎么又这样」', '「我想我们需要谈谈这个问题」', '沉默不说话', '用幽默带过去'] },
  { dim: '互动模式', q: '你心情不好时最希望伴侣怎么做？', options: ['我希望TA听我说完', '我希望TA给我一个解决方案', '我希望TA抱着我', '我希望TA给我独处空间'] },
  { dim: '互动模式', q: '你对「冷战」的态度是？', options: ['必须当天解决', '冷静一两天再谈', '等双方都准备好', '时间会冲淡一切'] },
  { dim: '互动模式', q: '你对「分享日常」的态度是？', options: ['主动分享自己的一切', '分享有趣的事', '只在对方问的时候说', '有些事不想说'] },
  { dim: '互动模式', q: '你对「说我爱你」的频率期待是？', options: ['需要频繁说', '重要时刻说就够了', '用行动代替', '不太会表达，但心里有'] },
  // === 意义系统 (q13-q18) ===
  { dim: '意义系统', q: '在关系中你最看重对方给你的？', options: ['被理解', '被需要', '被欣赏', '被信任'] },
  { dim: '意义系统', q: '以下哪句话最能打动你？', options: ['「我们的未来」', '「你今天过得怎样」', '「我看到了这个想到你」', '「我爱你」'] },
  { dim: '意义系统', q: '你对「三观一致」的看法是？', options: ['三观一致很重要，差太多不行', '可以有差异，但核心价值要一致', '差异不是问题，尊重就好', '三观可以磨合'] },
  { dim: '意义系统', q: '你的人生优先级是？', options: ['自由高于一切', '稳定高于一切', '成长高于一切', '快乐高于一切'] },
  { dim: '意义系统', q: '你对「门当户对」的看法是？', options: ['门当户对有一定道理', '爱情可以克服一切差异', '关键是两个人愿意一起努力', '家庭背景会影响但不决定'] },
  { dim: '意义系统', q: '你愿意为伴侣改变自己吗？', options: ['我愿意为TA改变很多', '我会保持自我，小妥协可以', '改变应该自然发生', '好的关系不需要改变'] },
  // === 动力发展 (q19-q24) ===
  { dim: '动力发展', q: '当你压力很大时，你最需要伴侣？', options: ['需要TA鼓励我', '需要TA给我空间', '需要TA陪我一起面对', '需要TA帮我分析'] },
  { dim: '动力发展', q: '你对「两个人一起成长」的期待是？', options: ['完全同步最好', '有各自节奏也行', '一方快一方慢很正常', '不确定'] },
  { dim: '动力发展', q: '你对「金钱观」的态度是？', options: ['经常沟通金钱观念', '各自管各自的', '一个人统一管理', 'AA制'] },
  { dim: '动力发展', q: '你介意伴侣的消费习惯和你不同吗？', options: ['非常介意', '有点在意', '不太在意', '完全不介意'] },
  { dim: '动力发展', q: '你更喜欢和什么样的人相处？', options: ['生', '熟', '半生不熟', '看心情'] },
  { dim: '动力发展', q: '你理想的关系模式是？', options: ['大男子/大女子主义', '势均力敌', '我喜欢被照顾', '我喜欢照顾人'] },
  // === 日常系统 (q25-q31) ===
  { dim: '日常系统', q: '你的日常作息是？', options: ['早睡早起', '晚睡晚起', '不规律', '规律但偏夜猫子'] },
  { dim: '日常系统', q: '周末你更喜欢？', options: ['出门探索', '宅家休息', '朋友聚会', '学习/搞副业'] },
  { dim: '日常系统', q: '你对卫生整洁的要求？', options: ['必须整洁', '大致整洁', '有点乱但自己知道', '看心情'] },
  { dim: '日常系统', q: '你对饮食的态度是？', options: ['规律三餐', '想吃就吃', '注重健康', '美食探索家'] },
  { dim: '日常系统', q: '生活习惯差异对恋爱的影响？', options: ['很重要，直接影响相处', '有些影响', '影响不大', '完全不重要'] },
  { dim: '日常系统', q: '你对手机依赖的看法？', options: ['完全不看', '偶尔看', '经常看', '随时刷'] },
  { dim: '日常系统', q: '当有重要的事想和对方说，你更倾向于？', options: ['直接说', '发消息', '暗示', '写信/长文'] },
]

const DIM_ICONS: Record<string, string> = {
  '安全联结': '🛡️',
  '互动模式': '💬',
  '意义系统': '🧭',
  '动力发展': '🚀',
  '日常系统': '🏠',
}

export default function SurveyPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(data => {
      if (!data.user) { router.push('/login'); return }
      if (data.user.surveyCompleted) router.push('/match')
    }).catch(() => router.push('/login'))
  }, [router])

  const currentQ = QUESTIONS[step]
  const progress = ((step + 1) / QUESTIONS.length) * 100

  // Count by dimension
  const dimCounts: Record<string, { total: number; answered: number }> = {}
  QUESTIONS.forEach((q, i) => {
    if (!dimCounts[q.dim]) dimCounts[q.dim] = { total: 0, answered: 0 }
    dimCounts[q.dim].total++
    if (answers[`q${i + 1}`]) dimCounts[q.dim].answered++
  })

  const handleSelect = (option: string) => {
    const key = `q${step + 1}`
    setAnswers({ ...answers, [key]: option })
    setTimeout(() => {
      if (step < QUESTIONS.length - 1) setStep(step + 1)
    }, 300)
  }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrf-token='))
        ?.split('=')[1] || ''
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(answers)
      })
      if (res.ok) router.push('/match')
      else {
        const data = await res.json()
        setError(data.error || '提交失败')
      }
    } catch {
      setError('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-10 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-float" />
        <div className="absolute bottom-20 left-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-float" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎁</span>
            <span className="font-bold text-xl gradient-text">吉动盲盒</span>
          </div>
          <span className="text-sm text-gray-400">{step + 1} / {QUESTIONS.length}</span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }} />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-500 text-center">
            {error}
          </div>
        )}

        {/* Dimension progress dots */}
        <div className="flex justify-center gap-4 mb-8">
          {Object.entries(dimCounts).map(([dim, c]) => (
            <div key={dim} className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                c.answered === c.total ? 'bg-pink-100' : 'bg-gray-100'
              }`}>
                {DIM_ICONS[dim]}
              </div>
              <span className="text-[10px] text-gray-400">{c.answered}/{c.total}</span>
            </div>
          ))}
        </div>

        {/* Dimension label */}
        <div className="mb-4">
          <span className="inline-block px-3 py-1 bg-pink-100 text-pink-600 rounded-full text-xs font-medium">
            {DIM_ICONS[currentQ.dim]} {currentQ.dim}
          </span>
        </div>

        {/* Question */}
        <h2 className="text-2xl font-bold text-gray-800 mb-8 animate-fade-in" key={step}>
          {currentQ.q}
        </h2>

        {/* Options */}
        <div className="space-y-3 mb-10">
          {currentQ.options.map((opt, i) => (
            <button key={`${step}-${i}`} onClick={() => handleSelect(opt)}
              className={`w-full text-left px-6 py-4 rounded-2xl border-2 transition-all duration-300 ${
                answers[`q${step + 1}`] === opt
                  ? 'border-pink-400 bg-gradient-to-r from-pink-50 to-purple-50 text-pink-700 shadow-md'
                  : 'border-gray-100 bg-white/60 hover:border-pink-200 hover:bg-pink-50/50 text-gray-600'
              }`}>
              <span className="font-medium">{opt}</span>
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
            className="px-6 py-2 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition">
            ← 上一题
          </button>

          {step === QUESTIONS.length - 1 ? (
            <button onClick={handleSubmit}
              disabled={saving || Object.keys(answers).length < QUESTIONS.length}
              className="px-8 py-3 text-white font-semibold bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 disabled:opacity-50 transition">
              {saving ? '提交中...' : `🎁 提交问卷（${Object.keys(answers).length}/${QUESTIONS.length}）`}
            </button>
          ) : (
            <button onClick={() => setStep(Math.min(QUESTIONS.length - 1, step + 1))}
              className="px-6 py-2 text-pink-500 font-medium hover:text-pink-600 transition">
              下一题 →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
