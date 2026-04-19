'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCsrfToken } from '@/lib/csrf'

// ── 滚动渐显 Hook（Intersection Observer，Apple 风格交错入场）──
function useScrollReveal(options?: { threshold?: number; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.unobserve(el) } },
      { threshold: options?.threshold ?? 0.15, rootMargin: options?.rootMargin ?? '0px 0px -40px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, visible }
}

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

// ── 翻牌数字动画组件 ──

function FlipBoardCount({ value, loading }: { value: number; loading: boolean }) {
  const [display, setDisplay] = useState('0')
  const [digits, setDigits] = useState<string[]>(['0'])

  useEffect(() => {
    if (!loading) {
      const target = String(value)
      if (target === display) return
      const maxLen = Math.max(digits.length, target.length)
      let frame = 0
      const totalFrames = 12 + maxLen * 4
      const interval = setInterval(() => {
        frame++
        const newDigits = target.padStart(maxLen, ' ').split('').map((char, i) => {
          if (frame > totalFrames - i * 3) return char
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
      const interval = setInterval(() => {
        const len = 1 + Math.floor(Math.random() * 2)
        setDigits(Array.from({ length: len }, () => String(Math.floor(Math.random() * 10))))
      }, 120)
      return () => clearInterval(interval)
    }
  }, [value, loading, digits.length])

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

export default function Home() {
  const router = useRouter()
  const { ref: heroRef, visible: heroVisible } = useScrollReveal()
  const { ref: howRef, visible: howVisible } = useScrollReveal()
  const { ref: campusRef, visible: campusVisible } = useScrollReveal({ threshold: 0.1 })
  const { ref: pricingRef, visible: pricingVisible } = useScrollReveal({ threshold: 0.1 })
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 })
  const [stats, setStats] = useState({ totalUsers: 0, completedSurvey: 0 })
  const [user, setUser] = useState<any>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [localSurveyDone, setLocalSurveyDone] = useState<boolean | null>(null)
  const [statsLoaded, setStatsLoaded] = useState(false)

  // Hydration-safe: read login state from cookies only on client
  useEffect(() => {
    setIsLoggedIn(hasLoggedInCookie())
    setLocalSurveyDone(getSurveyStatusFromCookie())
  }, [])

  useEffect(() => {
    function updateCountdown() {
      const now = new Date()
      const target = new Date(now)
      const utcDay = now.getUTCDay()
      const utcHours = now.getUTCHours()

      if (utcDay === 0 && utcHours >= 12) {
        target.setUTCDate(target.getUTCDate() + 7)
        target.setUTCHours(12, 0, 0, 0)
      } else {
        const daysToAdd = (7 - now.getUTCDay()) % 7
        target.setUTCDate(now.getUTCDate() + (daysToAdd || 0))
        target.setUTCHours(12, 0, 0, 0)
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

  const displayCount = <FlipBoardCount value={200 + (stats.completedSurvey || 0)} loading={!statsLoaded} />

  // ── Interactive "How it works" state ──
  const [activeStep, setActiveStep] = useState(0)
  const steps = [
    { num: '01', title: '完成深度问卷', desc: '涵盖性格底色、自我观察、人生方向等六大维度，35道题，约15分钟', cardType: 'survey' as const },
    { num: '02', title: '收到匹配邀请', desc: '每周轮次中为你匹配契合对象，并说明匹配原因', cardType: 'match' as const },
    { num: '03', title: '开启真诚对话', desc: '交换联系方式后，约见面、聊天，故事由你们续写', cardType: 'chat' as const },
  ]

  return (
    <div>
      {/* ══ HERO SECTION with Changchun night photo + La La Land overlay ══ */}
      <div className="relative overflow-hidden" style={{ minHeight: '100vh', paddingBottom: '12vh' }}>
        {/* Background photo — extends well below fold for smooth transition */}
        <div className="absolute inset-0 z-0" style={{ margin: '-40px', width: 'calc(100% + 80px)', height: 'calc(100% + 120px)' }}>
          <img
            src="/hero-bg.webp?v=2"
            alt=""
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 80%' }}
          />
        </div>

        {/* La La Land gradient overlay — very long gentle fade to page bg, no hard edge */}
        <div className="absolute inset-0 z-[1]" style={{
          background: `
            linear-gradient(to bottom,
              rgba(255,255,255,0) 0%,
              rgba(255,255,255,0) 20%,
              rgba(155,114,207,0.04) 32%,
              rgba(194,164,212,0.08) 44%,
              rgba(216,200,232,0.18) 55%,
              rgba(240,232,245,0.42) 66%,
              rgba(248,243,250,0.68) 76%,
              rgba(251,245,251,0.86) 84%,
              rgba(252,247,252,0.95) 90%,
              rgba(253,248,253,1) 96%
            ),
            linear-gradient(to top,
              rgba(10,5,24,0.45) 0%, rgba(45,27,105,0.28) 14%,
              rgba(155,114,207,0.08) 32%, transparent 52%
            )
          `,
          pointerEvents: 'none'
        }} />

        {/* Subtle purple blob (top-right only) */}
        <div className="fixed top-40 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float pointer-events-none" style={{ animationDelay: '1s', zIndex: 1 }} />

      <nav className="relative z-10 flex items-center justify-between px-6 md:px-8 py-3 w-full">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xl shrink-0">🎁</span>
          <span className="font-bold text-lg gradient-text truncate">吉爱酒窝</span>
        </div>
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {isLoggedIn ? (
            <>
              <Link href="/match" className="text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 transition px-4 py-1.5 shadow-md">
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
              }} className="text-xs font-medium text-gray-700 hover:text-red-600 px-2.5 py-1.5 border border-gray-300/60 rounded-full hover:bg-red-50/80 hover:border-red-300/60 transition bg-white/70 backdrop-blur shadow-sm">
                退出登录
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="px-3 py-1.5 text-sm font-medium text-pink-600 border border-pink-200/80 rounded-full hover:bg-pink-50 transition bg-white/80 backdrop-blur shadow-sm">
                登录
              </Link>
              <Link href="/login?mode=register" className="px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 transition shadow-md">
                注册
              </Link>
            </>
          )}
        </div>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-16 pb-24 text-center">
        <div ref={heroRef} className={`mb-6 inline-flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur rounded-full text-sm text-gray-500 border border-white/30 ${heroVisible ? 'animate-fade-in' : 'opacity-0'}`}>
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          已有 <span className="font-semibold text-pink-600">{displayCount}</span> 位同学完成测试
        </div>

        <div className={heroVisible ? 'animate-fade-in' : 'opacity-0'} style={{ animationDelay: '80ms' }}>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
            <span className="gradient-text">不止于相遇</span>
            <br />
            <span className="text-gray-800">致力于相知</span>
          </h1>
        </div>

        <div className={heroVisible ? 'animate-fade-in' : 'opacity-0'} style={{ animationDelay: '160ms' }}>
          <p className="text-base sm:text-lg text-amber-50/90 mb-10 max-w-xl mx-auto leading-relaxed drop-shadow-[0_1px_3px_rgba(0,0,0,.4)]">
            长春高校专属盲盒交友平台<br />
            基于心理学深度兼容性测试，每周为你匹配一位灵魂契合的TA
          </p>
        </div>

        <div
          className={`rounded-2xl p-4 sm:p-6 mb-10 max-w-md mx-auto interactive-card backdrop-blur-md ${heroVisible ? 'animate-fade-in' : 'opacity-0'}`}
          style={{ animationDelay: '240ms', background: 'rgba(255,255,255,0.30)', border: '1px solid rgba(255,255,255,0.35)' }}
        >
          <p className="text-xs sm:text-sm text-gray-400 mb-3">距下次匹配</p>
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {[
              { val: countdown.days, label: '天' },
              { val: countdown.hours, label: '时' },
              { val: countdown.mins, label: '分' },
              { val: countdown.secs, label: '秒' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center bg-gradient-to-br from-pink-500 to-purple-500 rounded-xl text-white text-lg sm:text-2xl font-bold shadow-lg">
                  {String(item.val).padStart(2, '0')}
                </div>
                <span className="text-[10px] sm:text-xs text-gray-400 mt-1">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {isLoggedIn ? (
          <Link href={localSurveyDone ? '/match' : '/survey'} className="inline-block px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 via-red-400 to-purple-500 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 btn-press animate-fade-in" style={{ animationDelay: '320ms' }}>
            {localSurveyDone ? '💌 查看匹配' : '🎁 继续测试'}
          </Link>
        ) : (
          <Link href="/login?mode=register" className="inline-block px-8 sm:px-10 py-3 sm:py-4 text-base sm:text-lg font-semibold text-white bg-gradient-to-r from-pink-500 via-red-400 to-purple-500 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 btn-press animate-fade-in" style={{ animationDelay: '320ms' }}>
            🎁 开始测试
          </Link>
        )}
      </main>

      {/* End of Hero section */}
      </div>

      {/* How it works - Interactive */}
      <section ref={howRef} className={`relative z-10 max-w-5xl mx-auto px-6 py-20 ${howVisible ? 'animate-fade-in' : 'opacity-0'}`}>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-0 rounded-3xl overflow-hidden shadow-xl">
          {/* ── Left Panel: Steps ── */}
          <div className="bg-white p-6 sm:p-10 md:p-14 flex flex-col justify-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-8 sm:mb-12">如何运作</h2>

            {steps.map((step, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i)}
                className={`relative flex items-start gap-5 mb-10 last:mb-0 text-left transition-all duration-300 cursor-pointer ${
                  activeStep === i ? 'scale-[1.02]' : 'opacity-45 hover:opacity-65'
                }`}
              >
                <div
                  className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500 ${
                    activeStep === i
                      ? 'bg-gradient-to-br from-pink-500 to-purple-600 text-white shadow-md'
                      : 'border-2 border-gray-300 text-gray-400'
                  }`}
                >
                  {step.num}
                </div>
                <div className="pt-1.5">
                  <h3 className={`font-bold text-lg mb-1.5 transition-colors duration-300 ${
                    activeStep === i ? 'text-gray-900' : 'text-gray-600'
                  }`}>
                    {step.title}
                  </h3>
                  <p className={`text-sm leading-relaxed transition-colors duration-300 ${
                    activeStep === i ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    {step.desc}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* ── Right Panel: Preview Card ── */}
          <div className="relative bg-gradient-to-br from-slate-700 via-indigo-800 to-purple-900 flex items-center justify-center min-h-[340px] sm:min-h-[420px] overflow-hidden px-4 sm:px-0 py-4">
            <div
              key={activeStep}
              className="w-full max-w-[260px] sm:max-w-[290px] px-4 sm:px-6 animate-slideIn"
              style={{ animationDuration: '0.5s' }}
            >
              {(() => {
                switch (steps[activeStep].cardType) {
                  case 'survey':
                    return (
                      <div className="bg-white/95 backdrop-blur rounded-2xl p-4 sm:p-6 shadow-2xl">
                        <div className="flex items-center gap-3 mb-4 sm:mb-5 pb-3 border-b border-gray-100">
                          <span className="text-base">📝</span>
                          <p className="font-bold text-gray-900 text-sm">深度问卷</p>
                        </div>
                        <div className="space-y-3">
                          <p className="text-xs text-gray-500 font-medium">你更认同哪种「安全感」？</p>
                          <div className="space-y-2">
                            {[
                              { label: '事事有回应', selected: false },
                              { label: '我的港湾与后盾', selected: true },
                              { label: '自由的牵挂', selected: false },
                              { label: '共同进步的战友', selected: false },
                            ].map((opt, j) => (
                              <div
                                key={j}
                                className={`px-3 py-2.5 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                                  opt.selected
                                    ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-md'
                                    : 'bg-gray-50 text-gray-500'
                                }`}
                                style={{ animation: `fadeInUp 0.4s ease-out ${j * 120 + 200}ms both` }}
                              >
                                <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none">
                                  {opt.selected ? (
                                    <><circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.3)"/><path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></>
                                  ) : (
                                    <><circle cx="8" cy="8" r="7" fill="#f3f4f6" stroke="#e5e7eb"/></>
                                  )}
                                </svg>
                                {opt.label}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )

                  case 'match':
                    return (
                      <div className="bg-white/95 backdrop-blur rounded-2xl p-4 sm:p-6 shadow-2xl">
                        <div className="flex items-center gap-2 mb-3 sm:mb-4 pb-3 border-b border-gray-100">
                          <span className="text-base">💫</span>
                          <p className="font-bold text-gray-900 text-sm">你的匹配：小明</p>
                        </div>
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>📧</span>
                            <span>xiaoming@example.com</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span>💜</span>
                            <span className="font-bold text-orange-500">94.7%</span>
                            <span className="text-gray-400">契合度</span>
                          </div>
                          <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                            <p className="text-xs text-gray-500 font-medium mb-2">匹配原因：</p>
                            <ul className="space-y-1.5 text-xs text-gray-500">
                              {[
                                '你们在「安全联结」维度高度契合',
                                '核心价值观：情绪价值 · 个人成长',
                                '面对冲突时，双方都是海豚型',
                              ].map((line, j) => (
                                <li
                                  key={j}
                                  style={{ animation: `fadeInUp 0.35s ease-out ${j * 130 + 250}ms both` }}
                                >
                                  <span className="text-gray-300 mr-1">·</span>{line}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )

                  case 'chat':
                    return (
                      <div className="bg-white/95 backdrop-blur rounded-2xl p-4 sm:p-5 shadow-2xl">
                        <div className="flex items-center gap-3 mb-3 sm:mb-4 pb-3 border-b border-gray-100">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-400 to-purple-400 flex items-center justify-center text-white text-sm font-bold">明</div>
                          <div>
                            <p className="font-bold text-gray-900 text-sm">小明</p>
                            <p className="text-[10px] text-gray-400">刚刚在线</p>
                          </div>
                        </div>

                        {/* 消息气泡 */}
                        <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-4">
                          <div
                            className="max-w-[85%] bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2.5 rounded-2xl rounded-tl-sm text-xs leading-relaxed"
                            style={{ animation: 'fadeInUp 0.4s ease-out 200ms both' }}
                          >
                            周末有空一起喝杯咖啡吗？我知道一家很安静的书店 ☕
                          </div>
                          <div
                            className="max-w-[80%] ml-auto bg-gray-50 text-gray-700 px-4 py-2.5 rounded-2xl rounded-tr-sm text-xs leading-relaxed"
                            style={{ animation: 'fadeInUp 0.4s ease-out 450ms both' }}
                          >
                            好呀，周六下午怎么样？☺️
                          </div>
                          <div
                            className="max-w-[85%] bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2.5 rounded-2xl rounded-tl-sm text-xs leading-relaxed"
                            style={{ animation: 'fadeInUp 0.4s ease-out 700ms both' }}
                          >
                            没问题！那下午两点见 📚
                          </div>
                        </div>

                        {/* 输入框 */}
                        <div
                          className="flex items-center gap-2 bg-gray-50 rounded-full px-4 py-2.5 border border-gray-100"
                          style={{ animation: 'fadeInUp 0.4s ease-out 900ms both' }}
                        >
                          <input
                            type="text"
                            placeholder="输入消息..."
                            readOnly
                            className="flex-1 min-w-0 bg-transparent text-xs text-gray-400 outline-none placeholder:text-gray-300"
                          />
                          <div className="w-7 h-7 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 flex items-center justify-center text-white text-[10px] shrink-0">
                            ➤
                          </div>
                        </div>
                      </div>
                    )
                }
              })()}
            </div>

            {/* Page indicator dots */}
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveStep(i)}
                  className={`rounded-full transition-all duration-300 cursor-pointer ${
                    activeStep === i ? 'w-6 h-2.5 bg-white/90 shadow-sm' : 'w-2 h-2 bg-white/30 hover:bg-white/50'
                  }`}
                  aria-label={`步骤 ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Campus only */}
      <section ref={campusRef} className={`relative z-10 max-w-3xl mx-auto px-6 py-12 ${campusVisible ? 'animate-fade-in' : 'opacity-0'}`}>
        <div className="glass-card rounded-3xl p-8 text-center interactive-card">
          <div className="text-4xl mb-3">📍</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">仅限长春高校同学</h3>
          <p className="text-gray-500 text-sm">
            注册时需通过GPS定位验证你在长春高校圈内（吉林大学/东北师范大学/<br />
            吉林动画学院/吉林外国语大学/长春大学/吉林艺术学院，15km范围）<br />
            确保每一位参与者都是真实的高校同学
          </p>
        </div>
      </section>

      {/* ══ 我们的特别 ══ */}
      {(() => {
        const features = [
          {
            icon: '❤️',
            title: '真实学生认证',
            desc: '注册时需通过GPS定位验证你在长春高校圈内，部分学校还需校内邮箱验证，确保每位用户都是真实在校大学生。',
          },
          {
            icon: '🎯',
            title: '平台属性',
            desc: '这是面向长春高校的非盈利校园匹配平台，不推广不商业化，仅创造一个能提供缘分的平台，提供给有需要的同学自行使用。',
          },
          {
            icon: '🔐',
            title: '数据安全',
            desc: '所有用户的账号密码和联系方式都是加密存储的，后台无法关联到任何个人。问卷答案采用匿名化处理，只有你和你的匹配对象能看到彼此的详细内容，管理员看不到私人数据。',
          },
          {
            icon: '⏱️',
            title: '匹配算法',
            desc: '先要完成深度问卷（涵盖性格底色、自我观察、人生方向等六大维度35题），然后双方是否方向一致、是否相处舒服、是否能彼此带动三个模块打分。其中若方向一致和是否舒服两个模块按相似计分；是否彼此带动模块按相似还是互补计分（由用户自行决定）。每周日20:00所有同学两两评分，获得60分以上的配对之后，用算法得到匹配结果，所有同学都会收到匹配邮件，轮空的同学会有邮件提醒放宽筛选条件～',
          },
        ]
        return (
          <section className={`relative z-10 max-w-4xl mx-auto px-6 py-16 ${campusVisible ? 'animate-fade-in' : 'opacity-0'}`}>
            <h2 className="text-3xl font-bold text-center text-gray-800 mb-10">我们的特别</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {features.map((f, i) => (
                <div key={i} className="bg-white/70 backdrop-blur-sm border border-white/50 rounded-2xl p-6 sm:p-7 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 interactive-card">
                  <div className="text-2xl mb-3">{f.icon}</div>
                  <h3 className="font-bold text-gray-800 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>
        )
      })()}

      {/* ══ 常见问题 FAQ ══ */}
      {(() => {
        const [openIndex, setOpenIndex] = useState<number | null>(null)
        const faqs = [
          { q: '使用流程是什么？', a: '首先注册账号并通过学生身份验证（GPS定位+邮箱），然后完成35道深度心理问卷（约15分钟）。之后每周末等待系统自动匹配，周日20:00揭晓本周的匹配对象。如果双方都愿意交换联系方式，就能拿到对方的联系信息啦~' },
          { q: '什么是盲盒交友？', a: '「盲盒」的意思是：你不知道会匹配到谁，对方也不知道会匹配到你。系统根据你们的问卷回答计算契合度，在你们互相看到对方信息之前，一切都是未知的。这种设计避免了「看脸社交」的偏见，让大家更关注内在契合度。' },
          { q: '验证码发送成功，但邮箱为什么收不到验证码？', a: '可能填错了邮箱地址，或者填的不是校园邮箱。请检查邮箱地址是否正确，确保使用的是学校分配的校内邮箱。如果确认邮箱无误但仍收不到，请查看垃圾邮件。' },
          { q: '是否会匹配到非学校人员（社会及非本科及以上人士）？', a: '目前吉大、东北师范等需要邮箱注册的学校不会匹配到校外人员，由于吉动、长大、吉林艺术学院没有为学生单独配置邮箱，所以采用了GPS验证，理论上是有校外人员的风险，好在我们为您设置了自定义匹配指定学校的功能。（后续对没有学生邮箱的学校怎么认证，还会再更新，现在为了让用户不暴露更多隐私，只能做到这了。）' },
        ]
        return (
          <section className={`relative z-10 max-w-3xl mx-auto px-6 py-16 ${pricingVisible ? 'animate-fade-in' : 'opacity-0'}`}>
            <h2 className="text-3xl font-bold text-center text-gray-800 mb-10">常见问题</h2>
            <div className="space-y-3">
              {faqs.map((faq, i) => (
                <div key={i} className="bg-white/70 backdrop-blur-sm border border-white/50 rounded-2xl overflow-hidden interactive-card">
                  <button
                    onClick={() => setOpenIndex(openIndex === i ? null : i)}
                    className="w-full flex items-center justify-between p-5 sm:p-6 text-left cursor-pointer hover:bg-white/80 transition-colors"
                  >
                    <span className="font-medium text-gray-800 pr-4">{faq.q}</span>
                    <svg className={`shrink-0 w-5 h-5 text-gray-400 transition-transform duration-300 ${openIndex === i ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {openIndex === i && (
                    <div className="px-5 sm:px-6 pb-5 sm:pb-6 animate-fade-in">
                      <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })()}

      {/* Pricing */}
      <section ref={pricingRef} className={`relative z-10 max-w-3xl mx-auto px-6 py-16 text-center ${pricingVisible ? 'animate-fade-in' : 'opacity-0'}`}>
        <div className="glass-card rounded-3xl p-10 interactive-card">
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
