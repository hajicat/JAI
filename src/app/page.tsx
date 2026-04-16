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
  const [isLoggedIn, setIsLoggedIn] = useState(hasLoggedInCookie())
  const [localSurveyDone, setLocalSurveyDone] = useState(getSurveyStatusFromCookie())
  const [statsLoaded, setStatsLoaded] = useState(false)

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

  const displayCount = <FlipBoardCount value={stats.completedSurvey} loading={!statsLoaded} />

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
      <div className="relative min-h-[100vh] overflow-hidden">
        {/* Background photo */}
        <div className="absolute inset-0 z-0" style={{ margin: '-40px', width: 'calc(100% + 80px)', height: 'calc(100% + 80px)' }}>
          <img
            src="https://cloudflareimg.cdn.sn/i/69e0bb57e5d70_1776335703.webp"
            alt=""
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 55%' }}
          />
        </div>

        {/* La La Land gradient overlay */}
        <div className="absolute inset-0 z-[1]" style={{
          background: `
            linear-gradient(to bottom,
              rgba(255,255,255,0) 0%, rgba(255,255,255,0) 18%,
              rgba(155,114,207,0.06) 28%,
              rgba(194,164,212,0.15) 40%,
              rgba(216,200,232,0.35) 52%,
              rgba(255,255,255,0.68) 65%,
              rgba(255,255,255,0.92) 78%,
              rgba(255,255,255,1) 88%
            ),
            linear-gradient(to top,
              rgba(10,5,24,0.6) 0%, rgba(45,27,105,0.38) 14%,
              rgba(155,114,207,0.12) 32%, transparent 54%
            )
          `,
          pointerEvents: 'none'
        }} />

        {/* Subtle purple blob (top-right only) */}
        <div className="fixed top-40 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float pointer-events-none" style={{ animationDelay: '1s', zIndex: 1 }} />

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
        <div ref={heroRef} className={`mb-6 inline-flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur rounded-full text-sm text-gray-500 border border-white/30 ${heroVisible ? 'animate-fade-in' : 'opacity-0'}`}>
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          已有 <span className="font-semibold text-pink-600">{displayCount}</span> 位同学完成测试
        </div>

        <div className={heroVisible ? 'animate-fade-in' : 'opacity-0'} style={{ animationDelay: '80ms' }}>
          <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
            <span className="gradient-text">不止于相遇</span>
            <br />
            <span className="text-gray-800">致力于相知</span>
          </h1>
        </div>

        <div className={heroVisible ? 'animate-fade-in' : 'opacity-0'} style={{ animationDelay: '160ms' }}>
          <p className="text-lg text-gray-500 mb-10 max-w-xl mx-auto leading-relaxed">
            长春高校专属盲盒交友平台<br />
            基于心理学深度兼容性测试，每周为你匹配一位灵魂契合的TA
          </p>
        </div>

        <div className={`glass-card rounded-2xl p-6 mb-10 max-w-md mx-auto interactive-card ${heroVisible ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '240ms' }}>
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
          <Link href={localSurveyDone ? '/match' : '/survey'} className="inline-block px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 via-red-400 to-purple-500 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 btn-press animate-fade-in" style={{ animationDelay: '320ms' }}>
            {localSurveyDone ? '💌 查看匹配' : '🎁 继续测试'}
          </Link>
        ) : (
          <Link href="/login?mode=register" className="inline-block px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 via-red-400 to-purple-500 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 btn-press animate-fade-in" style={{ animationDelay: '320ms' }}>
            🎁 开始测试
          </Link>
        )}
      </main>

      {/* End of Hero section */}
      </div>

      {/* How it works - Interactive */}
      <section ref={howRef} className={`relative z-10 max-w-5xl mx-auto px-6 py-20 ${howVisible ? 'animate-fade-in' : 'opacity-0'}`}>
        <div className="grid md:grid-cols-[1fr_1.1fr] gap-0 rounded-3xl overflow-hidden shadow-xl">
          {/* ── Left Panel: Steps ── */}
          <div className="bg-white p-10 md:p-14 flex flex-col justify-center">
            <h2 className="text-3xl font-bold text-gray-800 mb-12">如何运作</h2>

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
          <div className="relative bg-gradient-to-br from-slate-700 via-indigo-800 to-purple-900 flex items-center justify-center min-h-[420px] overflow-hidden">
            <div
              key={activeStep}
              className="w-full max-w-[290px] px-6 animate-slideIn"
              style={{ animationDuration: '0.5s' }}
            >
              {(() => {
                switch (steps[activeStep].cardType) {
                  case 'survey':
                    return (
                      <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-2xl">
                        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-gray-100">
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
                      <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-2xl">
                        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
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
                      <div className="bg-white/95 backdrop-blur rounded-2xl p-5 shadow-2xl">
                        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-400 to-purple-400 flex items-center justify-center text-white text-sm font-bold">明</div>
                          <div>
                            <p className="font-bold text-gray-900 text-sm">小明</p>
                            <p className="text-[10px] text-gray-400">刚刚在线</p>
                          </div>
                        </div>

                        {/* 消息气泡 */}
                        <div className="space-y-3 mb-4">
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
            吉林动画学院/吉林外国语大学/长春大学，15km范围）<br />
            确保每一位参与者都是真实的高校同学
          </p>
        </div>
      </section>

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
