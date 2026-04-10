'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// 从 cookie 获取 CSRF Token
function getCsrfToken(): string {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf-token='))
    ?.split('=')[1] || ''
}

// === 新版题库：32题，5层分类 ===

interface Question {
  dim: string
  q: string
  options: string[]
}

const QUESTIONS: Question[] = [
  // ═══ A. 第一部分 (q1-q8) ═══
  { dim: '性格底色', q: '你正忙着做一件特别重要的事，旁边的人反复打断你，你最真实的第一反应更接近？', options: ['会烦，但会先让自己稳住，再说明我现在不方便', '会直接表现出不耐烦，但事后能恢复正常', '很容易把火气撒到当时在场的人身上', '会记很久，之后态度也会变差'] },
  { dim: '性格底色', q: '恋爱后，对方提出"想互相知道手机密码、实时共享定位"，你更接近？', options: ['可以商量，但不是默认义务', '密码无所谓，定位长期共享没必要', '我希望彼此都保留独立隐私', '我想知道对方的，但不太想让对方知道我的'] },
  { dim: '性格底色', q: '吵架时，你最担心自己会变成哪一种？', options: ['一着急就想马上说清楚', '先不说话，缓一缓再谈', '故意说重话，让对方也难受', '故意冷着对方，等TA先来低头'] },
  { dim: '性格底色', q: '如果你的朋友和别人起了严重冲突，而你知道朋友不一定占理，你通常会？', options: ['先把场面稳住，之后私下说朋友的问题', '先护住朋友情绪，但不会跟着一起攻击别人', '既然是我朋友，我肯定先一起对付外人', '赶紧躲开，别把麻烦沾到我身上'] },
  { dim: '性格底色', q: '路上看到一只脏兮兮、明显状态不好的流浪猫一直跟着你叫，你第一反应更像？', options: ['会觉得可怜，想办法给点吃的或求助', '有点想帮，但也会担心安全和卫生', '不敢接触，赶紧走开', '会拍个好玩的视频发给朋友吐槽一下'] },
  { dim: '性格底色', q: '对方说"今天有点累，想自己待一会儿，不太想聊天"，你更可能？', options: ['尊重，告诉TA需要我时找我', '会有点失落，但能理解', '会追问是不是我做错了什么', '会明显不高兴，觉得这就是在冷落我'] },
  { dim: '性格底色', q: '你在团队作业里发现，只要稍微钻点空子就能少做很多事，还不容易被发现，你更可能？', options: ['不做，觉得没必要', '会犹豫，但大概率不想冒这个险', '如果大家都这么干，我也会', '能省事为什么不省，规则本来就是给人绕的'] },
  { dim: '性格底色', q: '现在生活费不算宽裕，但你特别想买一个远超自己消费能力的东西，你更可能？', options: ['先攒钱，或者自己找额外收入', '找平替，等二手或降价', '分期先买了再说', '想办法让父母或对象给我买'] },

  // ═══ B. 第二部分 (q9-q14) ═══
  { dim: '自我观察', q: '遇到很讨厌的人或特别委屈的事，你心里会不会冒出不太体面的想法？', options: ['从来不会，我一直很正能量', '偶尔会，但知道那只是情绪', '会，而且会在脑子里反复想', '只对真正伤害过我的人才会有'] },
  { dim: '自我观察', q: '如果一定要承认自己在关系里的一个缺点，你更像？', options: ['太重感情，总是付出太多', '有时脾气急，说话会快', '有时会先顾自己，后知后觉才意识到', '太理性，偶尔显得不够热'] },
  { dim: '自我观察', q: '你做这套题的真实心态更接近？', options: ['挺认真，希望系统别乱配', '当成有点意思的测试做做看', '先看看有没有好看的人', '我主要想看看这套东西到底准不准'] },
  { dim: '自我观察', q: '如果你拿到一笔 3000 元的意外收入，你更倾向？', options: ['存起来，给之后更重要的事', '买一直想买但确实用得上的东西', '立刻奖励自己或请朋友吃喝玩', '拿去试试高风险投资'] },
  { dim: '自我观察', q: '如果你刚决定"这笔钱先存着"，结果第二天你最喜欢的一个绝版东西出现了，而且正好花光这笔钱，你更可能？', options: ['立刻拿下，机会更重要', '还是按原计划，不买', '借钱/花呗也想先拿下', '先忍住，等二手或以后再说'] },
  { dim: '自我观察', q: '你不小心做错事让别人很难堪，你第一反应更像？', options: ['先道歉，再想怎么补救', '先解释清楚不是故意的，再道歉', '先躲一下，等气氛过去', '只要不是故意的，就不用太上纲上线'] },

  // ═══ C. 第三部分 (q15-q21) ═══
  { dim: '人生方向', q: '原计划周末去学一项对自己很重要的东西，朋友突然喊你马上出去玩，你更可能？', options: ['按原计划学', '学完再去汇合', '立刻出门，朋友更重要', '试图把大家都拉到我的节奏里'] },
  { dim: '人生方向', q: '你更希望另一半是什么样的人？', options: ['情绪稳定，遇事不乱', '对未来有计划，愿意成长', '有趣松弛，跟TA在一起不累', '很懂我，能给我强烈的陪伴感'] },
  { dim: '人生方向', q: '你更能接受哪种"有缺点但能相处"的室友？', options: ['吵一点，但讲义气', '冷一点，但边界清楚、卫生好', '爱八卦，但肯分担家务', '乱一点，但情绪稳定、好说话'] },
  { dim: '人生方向', q: '对热点争议事件，你通常更接近？', options: ['先等信息完整，再判断', '很容易共情弱者', '不太关心，跟我关系不大', '忍不住去跟评论区辩论'] },
  { dim: '人生方向', q: '两个人在一起，你最不能接受哪种"不在一个频道"？', options: ['我在想未来，TA在混日子', '我在讲道理，TA只顾发脾气', '我愿意沟通，TA总在逃避', '我看重分寸，TA总觉得无所谓'] },
  { dim: '人生方向', q: '你更认同哪句话？', options: ['关系里最重要的是稳定和可靠', '关系里最重要的是共同成长', '关系里最重要的是轻松和快乐', '关系里最重要的是浓烈和偏爱'] },
  { dim: '人生方向', q: '如果有一段关系需要你改变很多，你会怎么看？', options: ['合适的关系会让人自然变好', '可以调整习惯，但不能失去自己', '与其改造彼此，不如找更合适的人', '爱我就应该为我改变一些'] },

  // ═══ D. 第四部分 (q22-q28) ═══
  { dim: '相处之道', q: '对方很委屈很难过时，你下意识更像？', options: ['先抱抱/陪着，让TA知道我在', '认真听TA说，陪TA骂两句也行', '帮TA分析问题，给方案', '给TA一点空间，等TA想说再说'] },
  { dim: '相处之道', q: '你对"分享日常"的理想频率更接近？', options: ['很多碎片都想立刻分享', '每天固定聊一会儿就挺好', '没什么特别的事不用天天报备', '更喜欢攒到见面时说'] },
  { dim: '相处之道', q: '一起旅行时，你最理想的相处方式？', options: ['我来做主安排', '对方安排，我负责配合和体验', '一起商量、分工', '随走随停，不想计划太细'] },
  { dim: '相处之道', q: '面对严重分歧，你更像哪种状态？', options: ['想赶紧讲清楚，不想拖', '需要一点时间消化，再谈', '很想确认对方是不是还在乎我', '会忍不住争出个对错'] },
  { dim: '相处之道', q: '如果这次争执里你受伤了，你更可能怎么处理？', options: ['我会主动找机会修复关系', '我希望给彼此一点时间，但不会故意拉长', '我通常等对方先来', '谁先低头谁就输了'] },
  { dim: '相处之道', q: '你更能接受哪种表达爱的方式？', options: ['高频沟通和及时回应', '说到做到、稳定靠谱', '行动照顾、生活上很落地', '尊重空间，但关键时候在场'] },
  { dim: '相处之道', q: '当你不开心时，你更希望对方怎么做？', options: ['主动察觉，来哄我', '问我需不需要聊', '先别打扰，等我整理好', '给我一个实际解决办法'] },

  // ═══ E. 第五部分 (q29-q32) ═══
  { dim: '生活节奏', q: '你的周末通常更接近？', options: ['规律型，白天有安排', '熬夜型，起得晚但有自己的节奏', '看心情，随机应变', '想规律但经常失败'] },
  { dim: '生活节奏', q: '你对居住环境的要求更接近？', options: ['很整洁，东西最好归位', '大致整洁就行', '乱一点也能接受', '真的很讨厌打扫，希望别人搞定'] },
  { dim: '生活节奏', q: '你怎么看待恋爱中的日常开销？', options: ['顺其自然，别算太死', '设共同预算会更安心', '比较偏向清楚AA', '我会期待一方明显多承担一些'] },
  { dim: '生活节奏', q: '你的社交能量更像？', options: ['比较外放，喜欢热闹和新鲜局', '有局会去，但也需要独处', '小圈子就够了，不爱太多社交', '很看对象，跟合拍的人才会打开'] },
]

const DIM_ICONS: Record<string, string> = {
  '性格底色': '💫',
  '自我观察': '✨',
  '人生方向': '🌟',
  '相处之道': '💕',
  '生活节奏': '☀️',
}

const DIM_COLORS: Record<string, string> = {
  '性格底色': 'from-rose-300 to-pink-400',
  '自我观察': 'from-amber-300 to-orange-400',
  '人生方向': 'from-violet-300 to-purple-500',
  '相处之道': 'from-emerald-300 to-teal-400',
  '生活节奏': 'from-sky-300 to-blue-400',
}

export default function SurveyPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [alreadyCompleted, setAlreadyCompleted] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(data => {
      if (!data.user) { router.push('/login'); return }
      if (data.user.surveyCompleted) setAlreadyCompleted(true)
    }).catch(() => router.push('/login'))
    .finally(() => setLoading(false))
  }, [router])

  /** 重填问卷：清除已有记录，从头开始 */
  const handleRetake = () => {
    setAlreadyCompleted(false)
    setAnswers({})
    setStep(0)
  }

  const currentQ = QUESTIONS[step]
  const progress = ((step + 1) / QUESTIONS.length) * 100

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

      {/* Loading state */}
      {loading && (
        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-gray-400">加载中...</div>
        </div>
      )}

      {/* Already completed → show retake prompt */}
      {!loading && alreadyCompleted && (
        <div className="relative z-10 max-w-lg mx-auto px-6 py-16 text-center">
          <div className="mb-6 text-5xl">🎁</div>
          <h1 className="text-2xl font-bold gradient-text mb-3">吉动盲盒</h1>
          <p className="text-gray-500 mb-2">你已完成过问卷</p>
          <div className="bg-pink-50 rounded-2xl p-6 mb-8 text-sm text-gray-600 leading-relaxed">
            <p className="font-medium text-gray-700 mb-2">📋 题库已全新升级</p>
            <ul className="text-left space-y-2 mt-3">
              <li>🛡️ 新增性格底色题——了解真实的你</li>
              <li>🔍 自我观察——帮你更了解自己</li>
              <li>💬 相处之道——找能咬合的齿轮</li>
              <li>🏠 生活节奏更精准</li>
            </ul>
          </div>
          <button onClick={handleRetake}
            className="px-8 py-3 text-white font-semibold bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 transition mb-4 w-full">
            🔄 重新填写问卷
          </button>
          <button onClick={() => router.push('/match')}
            className="px-6 py-2 text-gray-400 hover:text-gray-600 transition text-sm">
            查看当前匹配结果 →
          </button>
        </div>
      )}

      {/* Survey form */}
      {!loading && !alreadyCompleted && (
      <>
      <div className="relative z-10 max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xl shrink-0">🎁</span>
          <span className="font-bold text-lg gradient-text truncate">吉动盲盒</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href={alreadyCompleted ? '/match' : '/'} className="text-xs text-gray-400 hover:text-gray-600 hover:underline whitespace-nowrap">← 返回</Link>
          <button onClick={async () => {
            try {
              await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'x-csrf-token': getCsrfToken() },
              })
            } catch { /* ignore */ }
            router.push('/login')
          }} className="text-xs text-gray-400 hover:text-gray-600 px-2.5 py-1 border border-gray-200 rounded-full hover:bg-gray-50 transition">
            退出
          </button>
        </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${DIM_COLORS[currentQ.dim] || 'from-pink-500 to-purple-500'} transition-all duration-500`}
            style={{ width: `${progress}%` }} />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-500 text-center">
            {error}
          </div>
        )}

        {/* Dimension progress dots */}
        <div className="flex justify-center gap-3 mb-8">
          {Object.entries(dimCounts).map(([dim, c]) => (
            <div key={dim} className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                c.answered === c.total ? `bg-gradient-to-r ${DIM_COLORS[dim]} text-white` : 'bg-gray-100 text-gray-400'
              }`}>
                {DIM_ICONS[dim]}
              </div>
              <span className="text-[9px] text-gray-400">{c.answered}/{c.total}</span>
            </div>
          ))}
        </div>

        {/* Dimension label */}
        <div className="mb-4">
          <span className={`inline-block px-3 py-1 bg-gradient-to-r ${DIM_COLORS[currentQ.dim] || 'from-pink-100 to-purple-100'} text-white rounded-full text-xs font-medium`}>
            {DIM_ICONS[currentQ.dim]} {currentQ.dim}
          </span>
        </div>

        {/* Question */}
        <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-8 animate-fade-in leading-relaxed" key={step}>
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
              <span className="font-medium"><span className="text-pink-300 mr-2">{String.fromCharCode(65 + i)}.</span>{opt}</span>
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
      </>
      )}
    </div>
  )
}
