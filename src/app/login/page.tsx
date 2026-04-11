'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

// 从 cookie 获取 CSRF Token
function getCsrfToken(): string {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf-token='))
    ?.split('=')[1] || ''
}

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
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const [gpsMsg, setGpsMsg] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsRequired, setGpsRequired] = useState(true)

  // 加载系统设置（GPS是否必需）
  useEffect(() => {
    fetch('/api/public-settings')
      .then(r => r.json())
      .then(d => {
        if (typeof d.gpsRequired === 'boolean') setGpsRequired(d.gpsRequired)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(data => {
      if (data.user) {
        if (data.user.isAdmin) router.push('/admin')
        else if (!data.user.surveyCompleted) router.push('/survey')
        else router.push('/match')
      }
    }).catch(() => {})
  }, [router])

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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude }),
          })
          const data = await res.json()

          if (data.withinRange) {
            setGpsStatus('ok')
            setGpsMsg(`✅ 定位成功！距学校${data.distance}km`)
          } else {
            setGpsStatus('fail')
            setGpsMsg(`❌ 你不在学校附近（距${data.distance}km，需要${data.radiusKm}km内）`)
          }
        } catch {
          setGpsStatus('fail')
          setGpsMsg('定位验证失败，请重试')
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (isRegister && gpsRequired && gpsStatus !== 'ok') {
      setError('请先完成GPS定位验证')
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

    setLoading(true)

    try {
      const url = isRegister ? '/api/auth/register' : '/api/auth/login'
      const body = isRegister
        ? {
            nickname: form.nickname, email: form.email,
            password: form.password, inviteCode: form.inviteCode,
            gender: form.gender, preferredGender: form.preferredGender,
            latitude: coords?.lat, longitude: coords?.lng,
          }
        : { email: form.email, password: form.password }

      let res: Response
      try {
        // 10秒超时控制
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
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
        setShowRegSuccess(true)
        setTimeout(() => router.push('/survey'), 2000)
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
          <div className="glass-card rounded-3xl p-10 text-center shadow-2xl animate-fade-in">
            <div className="text-6xl mb-4 animate-bounce">🎁</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">注册成功！</h2>
            <p className="text-gray-500">正在进入问卷...</p>
          </div>
        </div>
      )}

      <div className="relative z-10 w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <span className="text-3xl">🎁</span>
          <span className="font-bold text-2xl gradient-text">吉动盲盒</span>
        </Link>

        <div className="glass-card rounded-3xl p-8 shadow-xl">
          <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">
            {isRegister ? '创建账号' : '欢迎回来'}
          </h2>
          <p className="text-sm text-gray-400 text-center mb-6">
            {isRegister ? '仅限吉林动画学院同学，需GPS验证' : '登录你的吉动盲盒账号'}
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
                    <span className="text-sm font-medium text-gray-600">📍 GPS 校内验证</span>
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
                    {gpsStatus === 'checking' ? '定位中...' : gpsStatus === 'ok' ? '重新验证' : '点击验证位置'}
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

                {/* Invite Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">邀请码</label>
                  <input type="text" placeholder="输入邀请码（找同学要）"
                    value={form.inviteCode} onChange={e => setForm({ ...form, inviteCode: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition uppercase" required />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">邮箱</label>
              <input type="email" placeholder="你的邮箱（用于登录）"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition" required autoComplete="email" />
            </div>

            {/* 密码 + 显示/隐藏切换 */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">密码</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"}
                  placeholder={isRegister ? "设置密码（至少8位，含字母和数字）" : "请输入密码"}
                  value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full px-4 py-3 pr-10 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition"
                  required minLength={8} autoComplete={isRegister ? 'new-password' : 'current-password'} />
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
