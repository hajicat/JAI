'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

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
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (netErr) {
        setError('网络连接失败，请检查网络后重试')
        return
      }

      // 安全解析 JSON，防止非 JSON 响应导致二次异常
      let data: any
      try {
        data = await res.json()
      } catch {
        setError('服务器响应异常，请稍后重试')
        return
      }

      if (!res.ok) {
        setError(data.error || `请求失败（${res.status}）`)
        return
      }

      if (isRegister) router.push('/survey')
      else {
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
                {/* GPS Verification (only shown when required) */}
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
                {/* End GPS Verification */}

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

                {/* Nickname */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">昵称</label>
                  <input type="text" placeholder="你想被叫什么？"
                    value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })}
                    className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition" required />
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

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">密码</label>
              <input type="password" placeholder={isRegister ? "设置密码（至少8位，含字母和数字）" : "请输入密码"}
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition"
                required minLength={8} autoComplete={isRegister ? 'new-password' : 'current-password'} />
            </div>

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
