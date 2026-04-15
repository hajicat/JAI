'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCsrfToken } from '@/lib/csrf'

// ── 同步工具（纯字符串操作，无网络请求，渲染时即可调用）──

/** 从 cookie 同步读取登录状态（非 httpOnly，前端可直接访问） */
function hasLoggedInCookie(): boolean {
  if (typeof document === 'undefined') return false
  const cookies = document.cookie.split(';')
  return cookies.some(c => {
    const trimmed = c.trim()
    return trimmed.startsWith('loggedIn=true') || trimmed.startsWith('logged_in=true')
  })
}

/** 从 cookie 同步读取问卷完成状态 */
function getSurveyStatusFromCookie(): boolean | null {
  if (typeof document === 'undefined') return null
  const cookies = document.cookie.split(';')
  for (const c of cookies) {
    const trimmed = c.trim()
    if (trimmed.startsWith('survey_status=')) {
      return trimmed.slice(14) === 'done' // 'survey_status='.length = 14
    }
  }
  return null
}

// 从 cookie 获取 CSRF Token — 已提取到 @/lib/csrf（getCsrfToken）

// ── 翻牌数字动画组件 ──

function FlipBoardCount({ value, loading }: { value: number; loading: boolean }) {
  const [display, setDisplay] = useState('0')
  // Each digit independently tracks its current shown value
  const [digits, setDigits] = useState<string[]>(['0'])

  useEffect(() => {
    if (!loading) {
      // Settle: animate to final value
      const target = String(value)
      if (target === display) return
      // Animate each digit position with staggered timing
      const maxLen = Math.max(digits.length, target.length)
      let frame = 0
      const totalFrames = 12 + maxLen * 4 // more frames for longer numbers
      const interval = setInterval(() => {
        frame++
        const newDigits = target.padStart(maxLen, ' ').split('').map((char, i) => {
          if (frame > totalFrames - i * 3) return char
          // Random roll during animation
          return String(Math.floor(Math.random() * 10))
        })
        setDigits(newDigits)
        if (frame >= totalFrames) {
          setDigits(target.split(''))
          clearInterval(interval)
          setDisplay(target)
        }
      }, 60)
      return () => clearInterval(interval)
    } else {
      // Rolling mode: keep flipping random numbers
      const interval = setInterval(() => {
        const len = 1 + Math.floor(Math.random() * 2) // 1-2 digits while loading
        setDigits(Array.from({ length: len }, () => String(Math.floor(Math.random() * 10))))
      }, 120)
      return () => clearInterval(interval)
    }
  }, [value, loading, digits.length]) // 包含 digits.length 防止位数变化时边界渲染闪烁

  return (
    <span className="inline-flex font-mono">
      {digits.map((d, i) => (
        <span
          key={i}
          className={`inline-block w-[1ch] text-center tabular-nums transition-all duration-150 ${
            !loading ? 'text-pink-600' : 'text-pink-400'
          } ${loading ? 'animate-pulse' : ''}`}
          style={{
            transform: loading ? `translateY(${Math.random() * 2 - 1}px)` : 'translateY(0)',
            opacity: loading ? 0.7 + Math.random() * 0.3 : 1,
          }}
        >
          {d}
        </span>
      ))}
    </span>
  )
}

// ── 聊天预览卡片（"如何运作"区域右侧）──

function ChatPreviewCard() {
  const [currentMsg, setCurrentMsg] = useState(0)
  const messages = [
    { from: 'them', text: '周末有空一起喝杯咖啡吗？我知道一家很好喝的店～', delay: 800 },
    { from: 'me', text: '好呀，周六下午怎么样？', delay: 2000 },
  ]

  useEffect(() => {
    messages.forEach((msg, i) => {
      if (i === 0) setCurrentMsg(1)
      setTimeout(() => setCurrentMsg(i + 1), msg.delay)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="glass-card rounded-3xl p-6 bg-gradient-to-br from-[#5b4a7a] to-[#4a3868] shadow-xl">
      {/* Chat Header */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-300 to-purple-300 flex items-center justify-center text-sm font-bold text-white shadow-md">
          明
        </div>
        <div>
          <p className="text-white font-semibold text-sm">小明</p>
          <p className="text-white/40 text-xs">刚刚在线</p>
        </div>
      </div>

      {/* Messages */}
      <div className="space-y-3 min-h-[160px]">
        {currentMsg >= 1 && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-gradient-to-r from-pink-600/90 to-purple-600/90 text-white text-sm px-4 py-2.5 rounded-2xl rounded-bl-md max-w-[85%] leading-relaxed shadow-md">
              {messages[0].text}
            </div>
          </div>
        )}
        {currentMsg >= 2 && (
          <div className="flex justify-end animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="bg-white text-gray-700 text-sm px-4 py-2.5 rounded-2xl rounded-br-md max-w-[85%] leading-relaxed shadow-md">
              {messages[1].text}
            </div>
          </div>
        )}

        {/* Input (always shown) */}
        <div className="flex items-center gap-2 pt-2">
          <input
            type="text"
            placeholder="输入消息..."
            readOnly
            className="flex-1 bg-white/10 border border-white/10 rounded-full px-4 py-2 text-xs text-white placeholder-white/30 focus:outline-none cursor-default"
          />
          <button className="w-9 h-9 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full flex items-center justify-center text-white text-sm shadow-md shrink-0">
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const router = useRouter()
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 })
  const [stats, setStats] = useState({ totalUsers: 0, completedSurvey: 0 })
  // ── 关键改进：用 cookie 同步判断初始登录状态，首帧即可渲染正确按钮 ──
  const [user, setUser] = useState<any>(null)
  // isLoggedIn 用于 UI 渲染：true = 已登录（cookie 有 token），false = 未登录
  // API 返回后 user 会包含完整信息，但按钮跳转不需要等
  const [isLoggedIn, setIsLoggedIn] = useState(hasLoggedInCookie())
  // surveyCompleted 同步读取：首帧即知是否已完成问卷（不依赖 API）
  const [localSurveyDone, setLocalSurveyDone] = useState(getSurveyStatusFromCookie())
  // statsLoaded 仅用于翻牌动画
  const [statsLoaded, setStatsLoaded] = useState(false)

  useEffect(() => {
    function updateCountdown() {
      const now = new Date()

      // 目标：北京时间本周日或下周日 20:00（匹配结果揭晓时刻）
      // 北京时间 20:00 = UTC 12:00
      const target = new Date(now)
      const utcDay = now.getUTCDay()
      const utcHours = now.getUTCHours()

      if (utcDay === 0 && utcHours >= 12) {
        // 已过北京时间周日20:00，跳到下个周日
        target.setUTCDate(target.getUTCDate() + 7)
        target.setUTCHours(12, 0, 0, 0)
      } else {
        // 统一使用 UTC 计算（与 match/page.tsx 和 login/page.tsx 保持一致）
        const daysToAdd = (7 - now.getUTCDay()) % 7
        target.setUTCDate(now.getUTCDate() + (daysToAdd || 0))
        target.setUTCHours(12, 0, 0, 0) // 北京时间 20:00 = UTC 12:00
      }

      const diff = target.getTime() - now.getTime()
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const secs = Math.floor((diff % (1000 * 60)) / 1000)
      setCountdown({ days, hours, mins, secs })
    }

    updateCountdown()
    const timer = setInterval(updateCountdown, 1000)
    return () => clearInterval(timer)
  }, [])

  // Single combined API call for stats + user info
  // 注意：按钮跳转不再依赖此请求，cookie 同步判断已够用
  useEffect(() => {
    fetch('/api/home-data').then(r => r.json()).then(data => {
      setStats({ totalUsers: data.totalUsers || 0, completedSurvey: data.completedSurvey || 0 })
      if (data.user) {
        setUser(data.user)
        setIsLoggedIn(true)
        setLocalSurveyDone(!!data.user.surveyCompleted)
      } else {
        setIsLoggedIn(false)
        setLocalSurveyDone(null)
      }
    }).catch(() => {})
    .finally(() => setStatsLoaded(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const displayCount = <FlipBoardCount value={stats.completedSurvey} loading={!statsLoaded} />

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" />
        <div className="absolute top-40 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-yellow-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" style={{ animationDelay: '2s' }} />
      </div>

      <nav className="relative z-10 flex items-center justify-between px-4 py-3 max-w-6xl mx-auto gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xl shrink-0">🎁</span>
          <span className="font-bold text-lg gradient-text truncate">吉爱酒窝</span>
        </div>
        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <>
              <Link href="/match" className="text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 transition px-4 py-1.5">
                👤 个人信息
              </Link>
              <button onClick={async () => {
                try {
                  await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'x-csrf-token': getCsrfToken() },
                  })
                } catch { /* ignore */ }
                setUser(null)
                setIsLoggedIn(false)
                setLocalSurveyDone(null)
              }} className="text-xs text-gray-500 hover:text-red-500 px-2.5 py-1.5 border border-gray-200 rounded-full hover:bg-red-50 hover:border-red-200 transition">
                退出登录
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="px-3 py-1.5 text-sm font-medium text-pink-600 border border-pink-200 rounded-full hover:bg-pink-50 transition">
                登录
              </Link>
              <Link href="/login?mode=register" className="px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 transition">
                注册
              </Link>
            </>
          )}
        </div>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-16 pb-24 text-center">
        <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur rounded-full text-sm text-gray-500 border border-white/30">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          已有 <span className="font-semibold text-pink-600">{displayCount}</span> 位同学完成测试
        </div>

        <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
          <span className="gradient-text">不止于相遇</span>
          <br />
          <span className="text-gray-800">致力于相知</span>
        </h1>

        <p className="text-lg text-gray-500 mb-10 max-w-xl mx-auto leading-relaxed">
          长春高校专属盲盒交友平台<br />
          基于心理学深度兼容性测试，每周为你匹配一位灵魂契合的TA
        </p>

        <div className="glass-card rounded-2xl p-6 mb-10 max-w-md mx-auto">
          <p className="text-sm text-gray-400 mb-3">距下次匹配</p>
          <div className="flex items-center justify-center gap-3">
            {[
              { val: countdown.days, label: '天' },
              { val: countdown.hours, label: '时' },
              { val: countdown.mins, label: '分' },
              { val: countdown.secs, label: '秒' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="w-16 h-16 flex items-center justify-center bg-gradient-to-br from-pink-500 to-purple-500 rounded-xl text-white text-2xl font-bold shadow-lg">
                  {String(item.val).padStart(2, '0')}
                </div>
                <span className="text-xs text-gray-400 mt-1">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {isLoggedIn ? (
          <Link href={localSurveyDone ? '/match' : '/survey'} className="inline-block px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 via-red-400 to-purple-500 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300">
            {localSurveyDone ? '💌 查看匹配' : '🎁 继续测试'}
          </Link>
        ) : (
          <Link href="/login?mode=register" className="inline-block px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 via-red-400 to-purple-500 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300">
            🎁 开始测试
          </Link>
        )}
      </main>

      {/* How it works */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center text-gray-800 mb-16">如何运作</h2>
        <div className="grid lg:grid-cols-5 gap-12 items-start">
          {/* Left: Steps */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            {[
              {
                num: '01', title: '完成深度问卷', icon: '📝',
                desc: '涵盖性格底色、自我观察、人生方向、相处之道、生活节奏、个人画像六大维度，35道题，大约15分钟',
                detail: '你最认同哪种「爱的安全感」来源？\nA. 事事有回应  B. 我的后盾与港湾\nC. 自由的牵挂  D. 共同进步的战友'
              },
              {
                num: '02', title: '收到匹配邀请', icon: '💌',
                desc: '系统根据五维度兼容性自动匹配合适的TA，每周日揭晓结果',
                detail: '你的匹配：小林\n🎯 87% 契合度\n安全联结 92% | 互动模式 85%\n意义系统 88% | 动力发展 76%'
              },
              {
                num: '03', title: '开启真诚对话', icon: '☕',
                desc: '交换联系方式后，约见面、聊天，故事由你们续写。',
                detail: ''
              },
            ].map((step, i) => (
              <div key={i} className={`glass-card rounded-2xl p-6 hover:shadow-lg transition-all duration-300 group ${i === 2 ? 'lg:opacity-50' : ''}`}>
                <div className="flex items-center gap-3 mb-3">
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                    i === 2 ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white' : 'bg-white border-2 border-pink-200 text-pink-400'
                  }`}>
                    {i === 2 ? '03' : step.num}
                  </span>
                  <span className="text-2xl">{step.icon}</span>
                  <h3 className="text-lg font-bold text-gray-800">{step.title}</h3>
                </div>
                <p className="text-gray-500 text-sm ml-14">{step.desc}</p>
                {step.detail && (
                  <div className="mt-3 ml-14 bg-gray-50/80 rounded-xl p-3 text-xs text-gray-400 whitespace-pre-line group-hover:bg-pink-50/60 transition">
                    {step.detail}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right: Chat Preview Card */}
          <div className="lg:col-span-2 lg:sticky lg:top-24">
            <ChatPreviewCard />
          </div>
        </div>
      </section>

      {/* Campus only */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 py-12">
        <div className="glass-card rounded-3xl p-8 text-center">
          <div className="text-4xl mb-3">📍</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">仅限长春高校同学</h3>
          <p className="text-gray-500 text-sm">
            注册时需通过GPS定位验证你在长春高校圈内（吉林大学/东北师范大学/<br />
            吉林动画学院/吉林外国语大学/长春大学，15km范围）<br />
            确保每一位参与者都是真实的高校同学
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="glass-card rounded-3xl p-10">
          <h2 className="text-3xl font-bold text-gray-800 mb-3">完全免费，纯靠缘分</h2>
          <p className="text-gray-500 mb-8">校内平台，不收任何费用。每周日20:00自动匹配。</p>
          <Link href={isLoggedIn ? (localSurveyDone ? '/match' : '/survey') : '/login?mode=register'} className="inline-block px-8 py-3 text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full font-medium hover:opacity-90 transition">
            {isLoggedIn ? (localSurveyDone ? '查看匹配 →' : '继续测试 →') : '立即加入 →'}
          </Link>
        </div>
      </section>

    </div>
  )
}
