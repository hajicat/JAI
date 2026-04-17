'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getCsrfToken } from '@/lib/csrf'

// 从 cookie 获取 CSRF Token — 已提取到 @/lib/csrf（getCsrfToken）

type GenderOption = 'male' | 'female' | 'other' | ''
type PrefGenderOption = 'male' | 'female' | 'all' | ''

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isRegister, setIsRegister] = useState(searchParams.get('mode') === 'register')
  const [form, setForm] = useState({
    nickname: '', email: '', password: '', inviteCode: '',
    gender: '' as GenderOption, preferredGender: '' as PrefGenderOption,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [showRegSuccess, setShowRegSuccess] = useState(false)
  const [defaultPassword, setDefaultPassword] = useState('')
  // 忘记密码状态
  const [showForgotPwd, setShowForgotPwd] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSending, setForgotSending] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const [gpsMsg, setGpsMsg] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsRequired, setGpsRequired] = useState(true)
  const [inviteRequired, setInviteRequired] = useState(true)
  const [requiresSchoolEmail, setRequiresSchoolEmail] = useState(false)
  const [emailHint, setEmailHint] = useState('')

  // 邮箱验证码状态（仅注册模式使用）
  const [verificationCode, setVerificationCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeSending, setCodeSending] = useState(false)
  const [codeCooldown, setCodeCooldown] = useState(0)       // 倒计时秒数

  // 加载系统设置（GPS是否必需、邀请码是否必需）
  useEffect(() => {
    fetch('/api/public-settings')
      .then(r => r.json())
      .then(d => {
        if (typeof d.gpsRequired === 'boolean') setGpsRequired(d.gpsRequired)
        if (typeof d.inviteRequired === 'boolean') setInviteRequired(d.inviteRequired)
      })
      .catch(() => {})
  }, [])

  // 检查登录状态（注册模式不检查，避免覆盖正在填写的表单）
  useEffect(() => {
    if (isRegister) return // 注册模式：用户正在填写表单，不要抢跳
    fetch('/api/auth/me').then(r => r.json()).then(data => {
      if (data.user) {
        if (data.user.isAdmin) router.push('/admin')
        else if (!data.user.surveyCompleted) router.push('/survey')
        else router.push('/match')
      }
    }).catch(() => {})
  }, [router, isRegister])

  // GPS verification for registration
  const verifyGPS = () => {
    if (!navigator.geolocation) {
      setGpsStatus('fail')
      setGpsMsg('你的浏览器不支持定位功能')
      return
    }

    setGpsStatus('checking')
    setGpsMsg('正在获取位置...')

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        setCoords({ lat: latitude, lng: longitude })

        try {
          const res = await fetch('/api/geo', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': getCsrfToken(),
            },
            body: JSON.stringify({ latitude, longitude }),
          })
          const data = await res.json()

          if (!res.ok) {
            setGpsStatus('fail')
            setGpsMsg(`定位验证失败：${data.error || '未知错误'}`)
            return
          }

          if (data.withinRange) {
            setGpsStatus('ok')
            setGpsMsg(`✅ 定位成功！检测到您在「${data.location}」，距最近校区 ${data.nearestDistance ?? 0}km`)
            setRequiresSchoolEmail(data.requiresSchoolEmail)
            if (data.requiresSchoolEmail) {
              setEmailHint('💡 该区域需使用校内邮箱注册（@jlu / @mails.jlu / @nenu / @jisu）')
            }
          } else {
            setGpsStatus('fail')
            setGpsMsg(`❌ ${data.message || '不在高校范围内'}`)
          }
        } catch {
          setGpsStatus('fail')
          setGpsMsg('定位验证失败，请检查网络后重试')
        }
      },
      (err) => {
        setGpsStatus('fail')
        const msgs: Record<number, string> = {
          1: '请允许浏览器获取位置权限',
          2: '无法获取位置，请检查GPS是否开启',
          3: '定位超时，请重试',
        }
        setGpsMsg(msgs[err.code] || '定位失败')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  // 发送邮箱验证码
  const handleSendCode = async () => {
    if (!form.email) {
      setError('请先输入邮箱地址')
      return
    }

    const emailCheck = form.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/)
    if (!emailCheck) {
      setError('请输入正确的邮箱格式')
      return
    }

    // 校内邮箱前置校验：如果 GPS 检测到需要校内邮箱，非校内域名直接拦截
    if (requiresSchoolEmail) {
      const domain = form.email.split('@')[1]?.toLowerCase() || ''
      const allowedDomains = ['jlu.edu.cn', 'mails.jlu.edu.cn', 'nenu.edu.cn', 'jisu.edu.cn']
      if (!allowedDomains.includes(domain)) {
        setError('该区域必须使用校内邮箱注册（@jlu.edu.cn / @mails.jlu.edu.cn / @nenu.edu.cn / @jisu.edu.cn）')
        return
      }
    }

    setCodeSending(true)
    setError('')

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const res = await fetch('/api/auth/send-verification-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
        body: JSON.stringify({ email: form.email, nickname: form.nickname || '' }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const data = await res.json()

      if (!res.ok) {
        // 429 冷却/限流：尝试解析等待时间并启动倒计时
        if (res.status === 429 && data.error) {
          setError(data.error)
          // 从错误消息或 Retry-After 头提取秒数启动倒计时
          const cooldownMatch = data.error.match(/(\d+)\s*秒/)
          const retryHeader = res.headers.get('Retry-After')
          const waitSec = cooldownMatch ? parseInt(cooldownMatch[1]) : (retryHeader ? parseInt(retryHeader) : 0)
          if (waitSec > 0) {
            setCodeCooldown(waitSec)
            setCodeSent(true)
          }
        } else {
          setError(data.error || '发送失败')
        }
        return
      }

      setCodeSent(true)
      setCodeCooldown(60)  // 60 秒冷却

    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('请求超时，请重试')
      } else {
        setError('网络错误，请重试')
      }
    } finally {
      setCodeSending(false)
    }
  }

  // 验证码冷却倒计时
  useEffect(() => {
    if (codeCooldown <= 0) return
    const timer = setTimeout(() => setCodeCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [codeCooldown])

  // 忘记密码：发送重置链接
  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      setError('请输入注册邮箱')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) {
      setError('请输入正确的邮箱格式')
      return
    }

    setForgotSending(true)
    setError('')
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '发送失败')
        return
      }
      setForgotSent(true)
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setForgotSending(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 注册基础字段前端校验
    if (isRegister) {
      if (!form.nickname.trim()) {
        setError('请输入昵称')
        return
      }
      if (form.nickname.trim().length > 20) {
        setError('昵称最多20个字符')
        return
      }
      if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-·\s]{1,20}$/.test(form.nickname.trim())) {
        setError('昵称包含非法字符')
        return
      }
      if (!form.email.trim()) {
        setError('请输入邮箱')
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        setError('请输入正确的邮箱格式')
        return
      }
    }

    if (isRegister && gpsRequired && gpsStatus !== 'ok') {
      setError('请先完成高校圈定位验证')
      return
    }

    if (isRegister && (!form.gender || !form.preferredGender)) {
      setError('请选择性别信息')
      return
    }

    if (isRegister && !agreedToTerms) {
      setError('请先同意用户协议和隐私政策')
      return
    }

    // 注册模式：校验邮箱验证码
    if (isRegister) {
      if (!codeSent) {
        setError('请先获取邮箱验证码')
        return
      }
      if (!verificationCode || verificationCode.length !== 6) {
        setError('请输入6位邮箱验证码')
        return
      }

      // 校内邮箱二次校验（防止绕过前端发送验证码的检查）
      if (requiresSchoolEmail) {
        const domain = form.email.split('@')[1]?.toLowerCase() || ''
        const allowedDomains = ['jlu.edu.cn', 'mails.jlu.edu.cn', 'nenu.edu.cn', 'jisu.edu.cn']
        if (!allowedDomains.includes(domain)) {
          setError('该区域必须使用校内邮箱注册（@jlu.edu.cn / @mails.jlu.edu.cn / @nenu.edu.cn / @jisu.edu.cn）')
          return
        }
      }
    }

    setLoading(true)

    try {
      const url = isRegister ? '/api/auth/register' : '/api/auth/login'
      const body = isRegister
        ? {
            nickname: form.nickname, email: form.email,
            inviteCode: form.inviteCode,
            gender: form.gender, preferredGender: form.preferredGender,
            latitude: coords?.lat, longitude: coords?.lng,
            verificationCode,
          }
        : { email: form.email, password: form.password }

      let res: Response
      try {
        // 30秒超时控制
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': getCsrfToken(),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
      } catch (netErr: any) {
        if (netErr.name === 'AbortError') {
          setError('请求超时，请检查网络后重试')
        } else {
          setError('网络连接失败，请检查网络后重试')
        }
        setLoading(false) // ← 关键修复：失败时解除 loading
        return
      }

      let data: any
      try {
        data = await res.json()
      } catch {
        setError('服务器响应异常，请稍后重试')
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(data.error || `请求失败（${res.status}）`)
        setLoading(false)
        return
      }

      if (isRegister) {
        setLoading(false)
        setDefaultPassword(data.defaultPassword || '')
        setShowRegSuccess(true)
        setTimeout(() => router.push('/survey'), 4000)
        return
      } else {
        if (data.user.isAdmin) router.push('/admin')
        else if (!data.user.surveyCompleted) router.push('/survey')
        else router.push('/match')
      }
    } catch (err) {
      console.error('Auth error:', err)
      setError('操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" />
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" style={{ animationDelay: '1.5s' }} />
      </div>

      {/* 注册成功提示 */}
      {showRegSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="glass-card rounded-3xl p-10 text-center shadow-2xl animate-fade-in max-w-sm">
            <div className="text-6xl mb-4 animate-bounce">🎁</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">注册成功！</h2>
            <p className="text-gray-500 mb-4">正在进入问卷...</p>
            {defaultPassword && (
              <div className="bg-pink-50 border border-pink-200 rounded-xl p-4 mt-3">
                <p className="text-xs text-pink-500 font-medium mb-1">你的默认密码（请牢记）</p>
                <p className="text-lg font-mono font-bold text-pink-700 tracking-wider select-all">{defaultPassword}</p>
                <p className="text-xs text-gray-400 mt-2">登录后可在个人设置中修改</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="relative z-10 w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <span className="text-3xl">🎁</span>
          <span className="font-bold text-2xl gradient-text">吉爱酒窝</span>
        </Link>

        <div className="glass-card rounded-3xl p-8 shadow-xl">
          <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">
            {isRegister ? '创建账号' : '欢迎回来'}
          </h2>
          <p className="text-sm text-gray-400 text-center mb-6">
            {isRegister ? '仅限长春高校同学，需GPS验证' : '登录你的账号'}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-500 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <>
                {/* 昵称 — 放最前，降低心理门槛 */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">昵称</label>
                  <input type="text" placeholder="你想被叫什么？"
                    value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })}
                    className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition" required />
                </div>

                {/* GPS Verification */}
                {gpsRequired && (
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">📍 GPS 高校验证</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      gpsStatus === 'ok' ? 'bg-green-100 text-green-600' :
                      gpsStatus === 'fail' ? 'bg-red-100 text-red-600' :
                      gpsStatus === 'checking' ? 'bg-yellow-100 text-yellow-600' :
                      'bg-gray-200 text-gray-500'
                    }`}>
                      {gpsStatus === 'ok' ? '已验证' : gpsStatus === 'fail' ? '验证失败' : gpsStatus === 'checking' ? '验证中' : '未验证'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">仅用于校内身份验证，不存储原始位置信息</p>
                  {gpsMsg && <p className="text-xs text-gray-500 mb-2">{gpsMsg}</p>}
                  <button
                    type="button"
                    onClick={verifyGPS}
                    disabled={gpsStatus === 'checking'}
                    className="w-full py-2 text-sm font-medium text-pink-600 bg-white border border-pink-200 rounded-lg hover:bg-pink-50 transition disabled:opacity-50"
                  >
                    {gpsStatus === 'checking' ? '定位中...' : gpsStatus === 'ok' ? '重新验证' : '点击验证高校圈位置'}
                  </button>
                </div>
                )}

                {/* Gender Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-2">你的性别</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'male' as GenderOption, label: '👨 男' },
                      { value: 'female' as GenderOption, label: '👩 女' },
                      { value: 'other' as GenderOption, label: '🌈 其他' },
                    ].map(g => (
                      <button
                        key={g.value} type="button"
                        onClick={() => setForm({ ...form, gender: g.value })}
                        className={`py-2.5 rounded-xl text-sm font-medium border-2 transition ${
                          form.gender === g.value
                            ? 'border-pink-400 bg-pink-50 text-pink-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-pink-200'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-2">想匹配的性别</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'male' as PrefGenderOption, label: '👨 男' },
                      { value: 'female' as PrefGenderOption, label: '👩 女' },
                      { value: 'all' as PrefGenderOption, label: '🤷 都行' },
                    ].map(g => (
                      <button
                        key={g.value} type="button"
                        onClick={() => setForm({ ...form, preferredGender: g.value })}
                        className={`py-2.5 rounded-xl text-sm font-medium border-2 transition ${
                          form.preferredGender === g.value
                            ? 'border-pink-400 bg-pink-50 text-pink-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-pink-200'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Invite Code — 仅在开启时显示 */}
                {inviteRequired && (
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">邀请码</label>
                  <input type="text" placeholder="输入邀请码（找同学要）"
                    value={form.inviteCode} onChange={e => setForm({ ...form, inviteCode: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition uppercase" required />
                </div>
                )}
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">邮箱</label>
              <input type="email" placeholder="你的邮箱（用于登录和接收验证码）"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition" required autoComplete="email" />
              {isRegister && emailHint && (
                <p className="text-xs text-amber-600 mt-1.5 flex items-start gap-1">
                  <span>{emailHint}</span>
                </p>
              )}
              {isRegister && !emailHint && gpsStatus === 'idle' && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-start gap-1">
                  <span>💡</span>
                  <span>请先完成GPS定位，系统将自动判断是否需要校内邮箱</span>
                </p>
              )}
            </div>

            {/* 邮箱验证码（仅注册模式显示） */}
            {isRegister && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-600">📧 邮箱验证</label>
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={codeSending || codeCooldown > 0 || !form.email || (
                      requiresSchoolEmail ? (() => {
                        const d = form.email.split('@')[1]?.toLowerCase() || ''
                        return !['jlu.edu.cn','mails.jlu.edu.cn','nenu.edu.cn','jisu.edu.cn'].includes(d)
                      })() : false
                    )}
                    className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${
                      codeCooldown > 0
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : codeSending
                        ? 'bg-pink-100 text-pink-400 animate-pulse'
                        : 'bg-pink-100 text-pink-600 hover:bg-pink-200'
                    }`}
                  >
                    {codeSending
                      ? '发送中...'
                      : codeCooldown > 0
                      ? `${codeCooldown}s 后重发`
                      : codeSent
                      ? '重新发送'
                      : '获取验证码'}
                  </button>
                </div>
                <p className="text-xs text-gray-400">请输入发到邮箱的 6 位数字验证码，5 分钟内有效</p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="输入 6 位验证码"
                  value={verificationCode}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                    setVerificationCode(val)
                  }}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-300 transition tracking-[0.3em] text-center font-mono text-lg"
                />
              </div>
            )}

            {/* 密码 — 仅登录模式显示（注册自动生成拼音密码） */}
            {!isRegister && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">密码</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"}
                  placeholder="请输入密码"
                  value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full px-4 py-3 pr-10 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition"
                  required minLength={8} autoComplete="current-password" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition text-lg"
                  tabIndex={-1}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            )}

            {/* 用户协议勾选 */}
            {isRegister && (
              <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={e => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 accent-pink-500"
                />
                <span>
                  我已阅读并同意
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:underline mx-1">《用户协议》</a>
                  和
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:underline mx-1">《隐私政策》</a>
                </span>
              </label>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3 text-white font-semibold bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl hover:opacity-90 transition disabled:opacity-50">
              {loading ? '请稍候...' : (isRegister ? '🎁 注册' : '登录')}
            </button>
          </form>

          {/* 忘记密码（仅登录模式显示） */}
          {!isRegister && !showForgotPwd && (
            <div className="mt-3 text-center">
              <button
                onClick={() => { setShowForgotPwd(true); setError('') }}
                className="text-sm text-gray-400 hover:text-pink-500 transition"
              >
                忘记密码？
              </button>
            </div>
          )}

          {/* 忘记密码面板 */}
          {!isRegister && showForgotPwd && (
            <div className="mt-4 pt-5 border-t border-gray-100 animate-fade-in">
              <h3 className="text-base font-semibold text-gray-700 mb-1">🔑 找回密码</h3>
              <p className="text-xs text-gray-400 mb-4">输入你的注册邮箱，我们将发送重置链接</p>

              <div className="space-y-3">
                <input
                  type="email"
                  placeholder="注册邮箱"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition text-sm"
                  disabled={forgotSent}
                />

                {forgotSent ? (
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <p className="text-sm font-medium text-green-600">✅ 邮件已发送！</p>
                    <p className="text-xs text-green-500 mt-1">查收邮箱后点击重置链接设置新密码</p>
                    <button
                      onClick={() => { setShowForgotPwd(false); setForgotSent(false); setForgotEmail(''); setError('') }}
                      className="mt-3 text-sm text-pink-500 hover:underline"
                    >
                      返回登录
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleForgotPassword}
                      disabled={forgotSending || !forgotEmail}
                      className="flex-1 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl hover:opacity-90 transition disabled:opacity-50"
                    >
                      {forgotSending ? '发送中...' : '发送重置链接'}
                    </button>
                    <button
                      onClick={() => { setShowForgotPwd(false); setError('') }}
                      className="px-4 py-2.5 text-sm font-medium text-gray-400 border border-gray-200 rounded-xl hover:bg-gray-50 transition"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="mt-6 text-center text-sm text-gray-400">
            {isRegister ? '已有账号？' : '还没有账号？'}
            <button onClick={() => { setIsRegister(!isRegister); setError('') }}
              className="ml-1 text-pink-500 font-medium hover:underline">
              {isRegister ? '去登录' : '去注册'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">加载中...</p></div>}>
      <LoginForm />
    </Suspense>
  )
}
