'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// 从 cookie 获取 CSRF Token
function getCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf-token='))
    ?.split('=')[1] || ''
}

export default function Home() {
  const router = useRouter()
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 })
  const [stats, setStats] = useState({ totalUsers: 0, completedSurvey: 0 })
  const [user, setUser] = useState<any>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    function updateCountdown() {
      const now = new Date()
      const nextSunday = new Date(now)
      const daysUntilSunday = (7 - now.getDay()) % 7 || 7
      nextSunday.setDate(now.getDate() + daysUntilSunday)
      nextSunday.setHours(20, 0, 0, 0)
      if (nextSunday <= now) nextSunday.setDate(nextSunday.getDate() + 7)

      const diff = nextSunday.getTime() - now.getTime()
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

  // Single combined API call for stats + user info — much faster than 2 separate requests
  useEffect(() => {
    fetch('/api/home-data').then(r => r.json()).then(data => {
      setStats({ totalUsers: data.totalUsers || 0, completedSurvey: data.completedSurvey || 0 })
      if (data.user) setUser(data.user)
    }).catch(() => {})
    .finally(() => setAuthChecked(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const displayCount = !authChecked ? (
    <span className="inline-block w-8 h-4 bg-gray-200 rounded animate-pulse" />
  ) : stats.completedSurvey > 0 ? (
    stats.completedSurvey.toLocaleString()
  ) : (
    '0'
  )

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
          <span className="font-bold text-lg gradient-text truncate">吉动盲盒</span>
        </div>
        <div className="flex items-center gap-2">
          {!authChecked ? (
            <span className="text-xs text-gray-400 px-3">加载中...</span>
          ) : user ? (
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
          已有 <span className="font-semibold text-pink-600">{displayCount}</span> 位吉动人完成测试
        </div>

        <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
          <span className="gradient-text">不止于相遇</span>
          <br />
          <span className="text-gray-800">致力于相知</span>
        </h1>

        <p className="text-lg text-gray-500 mb-10 max-w-xl mx-auto leading-relaxed">
          吉林动画学院专属盲盒交友平台<br />
          基于心理学深度兼容性测试，每周为你匹配一位灵魂契合的吉动人
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

        <Link href="/login?mode=register" className="inline-block px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 via-red-400 to-purple-500 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300">
          🎁 开始测试
        </Link>
      </main>

      {/* How it works */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center text-gray-800 mb-16">如何运作</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              num: '01', title: '完成深度问卷', icon: '📝',
              desc: '涵盖安全联结、互动模式、意义系统、动力发展、日常系统五大维度，31道题，大约10分钟',
              detail: '你最认同哪种「爱的安全感」来源？\nA. 事事有回应  B. 我的后盾与港湾\nC. 自由的牵挂  D. 共同进步的战友'
            },
            {
              num: '02', title: '每周收到匹配', icon: '💌',
              desc: '系统每周日自动匹配，告诉你五维度分别的契合度和冲突类型',
              detail: '你的匹配：小林\n🎯 87% 契合度\n安全联结 92% | 互动模式 85%\n意义系统 88% | 动力发展 76% | 日常系统 90%\n🐬×🐕 冲突风格互补'
            },
            {
              num: '03', title: '开启真诚对话', icon: '☕',
              desc: '双方确认后交换联系方式，接下来的故事由你们自己书写',
              detail: '约一杯奶茶，聊聊彼此的人生剧本，看看会发生什么有趣的事～'
            },
          ].map((step, i) => (
            <div key={i} className="glass-card rounded-2xl p-8 hover:shadow-lg transition-all duration-300 group">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{step.icon}</span>
                <span className="text-sm font-bold text-pink-400">{step.num}</span>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-3">{step.title}</h3>
              <p className="text-gray-500 text-sm mb-4">{step.desc}</p>
              <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-400 whitespace-pre-line group-hover:bg-pink-50 transition">
                {step.detail}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Campus only */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 py-12">
        <div className="glass-card rounded-3xl p-8 text-center">
          <div className="text-4xl mb-3">📍</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">仅限校内同学</h3>
          <p className="text-gray-500 text-sm">
            注册时需通过GPS定位验证你在吉林动画学院1km范围内<br />
            确保每一位参与者都是真实的吉动人
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="glass-card rounded-3xl p-10">
          <div className="inline-block px-4 py-1 bg-pink-100 text-pink-600 rounded-full text-sm font-medium mb-4">限时免费</div>
          <h2 className="text-3xl font-bold text-gray-800 mb-3">完全免费，纯靠缘分</h2>
          <p className="text-gray-500 mb-6">校内平台，不收任何费用。每周日20:00自动匹配。</p>
          <div className="flex items-center justify-center gap-2 text-2xl font-bold gradient-text">
            ¥ 0 <span className="text-sm text-gray-400 font-normal">/永久</span>
          </div>
          <Link href="/login?mode=register" className="inline-block mt-6 px-8 py-3 text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full font-medium hover:opacity-90 transition">
            立即加入 →
          </Link>
        </div>
      </section>

      <footer className="relative z-10 text-center py-10 text-gray-400 text-sm">
        <p>🎁 吉动盲盒 © 2026 吉林动画学院 · 用心构建</p>
      </footer>
    </div>
  )
}
