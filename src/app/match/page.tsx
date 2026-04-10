'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface DimScore { name: string; score: number; compatible: boolean }
interface MatchData {
  id: number; partnerId: number; partnerNickname: string
  score: number; dimScores: DimScore[] | null; reasons: string[]
  weekKey: string; iRevealed: boolean; partnerRevealed: boolean
  partnerConflictType: string | null
  contact: { type: string; info: string } | null
}

const DIM_COLORS: Record<string, string> = {
  '安全联结': 'from-blue-400 to-cyan-400',
  '互动模式': 'from-green-400 to-emerald-400',
  '意义系统': 'from-purple-400 to-violet-400',
  '动力发展': 'from-orange-400 to-amber-400',
  '日常系统': 'from-pink-400 to-rose-400',
}

// 从 cookie 获取 CSRF Token
function getCsrfToken(): string {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf-token='))
    ?.split('=')[1] || ''
}

export default function MatchPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [match, setMatch] = useState<MatchData | null>(null)
  const [loading, setLoading] = useState(true)
  const [revealing, setRevealing] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteCodes, setInviteCodes] = useState<any[]>([])
  const [matchEnabled, setMatchEnabled] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = async () => {
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meData.user) { router.push('/login'); return }
      if (!meData.user.isAdmin && !meData.user.surveyCompleted) { router.push('/survey'); return }
      setUser(meData.user)
      setMatchEnabled(meData.user.matchEnabled)

      const matchRes = await fetch('/api/match')
      const matchData = await matchRes.json()
      if (matchData.match) setMatch(matchData.match)

      const inviteRes = await fetch('/api/invite')
      const inviteData = await inviteRes.json()
      setInviteCodes(inviteData.available || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
  }

  const handleReveal = async () => {
    if (!match) return
    setRevealing(true)
    try {
      const csrfToken = getCsrfToken()
      await fetch('/api/match', {
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ matchId: match.id })
      })
      const res = await fetch('/api/match')
      const data = await res.json()
      if (data.match) setMatch(data.match)
    } catch { /* silent fail */ }
    finally { setRevealing(false) }
  }

  const handleLogout = async () => {
    try {
      const csrfToken = getCsrfToken()
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      })
      router.push('/login')
    } catch {
      router.push('/login')
    }
  }

  const toggleMatch = async (enabled: boolean) => {
    setMatchEnabled(enabled)
    try {
      const csrfToken = getCsrfToken()
      await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          matchEnabled: enabled,
          ...(enabled ? {} : {}),
        })
      })
    } catch (e) { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center"><div className="text-5xl mb-4 animate-bounce">🎁</div><p className="text-gray-400">加载中...</p></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50">
      <nav className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎁</span>
          <span className="font-bold text-xl gradient-text">吉动盲盒</span>
        </div>
        <div className="flex items-center gap-3">
          {user?.isAdmin && (
            <Link href="/admin" className="px-4 py-1.5 text-sm text-pink-600 border border-pink-200 rounded-full hover:bg-pink-50 transition">管理后台</Link>
          )}
          <span className="text-sm text-gray-500">Hi, {user?.nickname}</span>
          <button onClick={handleRefresh}
            className={`text-xs text-pink-500 hover:text-pink-600 px-3 py-1.5 border border-pink-200 rounded-full hover:bg-pink-50 transition ${refreshing ? 'animate-spin' : ''}`}>
            {refreshing ? '刷新中...' : '🔄 刷新'}
          </button>
          <button onClick={handleLogout}
            className="px-3 py-1.5 text-sm text-gray-400 border border-gray-200 rounded-full hover:bg-gray-50 hover:text-gray-600 transition">
            退出
          </button>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Match Card */}
        {match ? (
          <div className="glass-card rounded-3xl p-8 shadow-xl animate-fade-in">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">💌</div>
              <h2 className="text-2xl font-bold text-gray-800">本周匹配结果</h2>
              <p className="text-sm text-gray-400 mt-1">{match.weekKey}</p>
            </div>

            {/* Partner Info */}
            <div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-2xl p-6 mb-6 text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-pink-300 to-purple-300 rounded-full flex items-center justify-center text-3xl text-white shadow-lg">
                {match.partnerNickname[0]}
              </div>
              <h3 className="text-xl font-bold text-gray-800">{match.partnerNickname}</h3>
              {match.partnerConflictType && (
                <p className="text-sm text-gray-500 mt-1">{match.partnerConflictType}</p>
              )}
              <div className="flex items-center justify-center gap-2 mt-2">
                <div className="text-3xl font-bold gradient-text">{match.score}%</div>
                <span className="text-gray-400 text-sm">契合度</span>
              </div>
            </div>

            {/* Dimension Scores */}
            {match.dimScores && match.dimScores.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-500 mb-3">📊 五维度契合度</h4>
                <div className="space-y-3">
                  {match.dimScores.map((dim, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-20 text-right">{dim.name}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${DIM_COLORS[dim.name] || 'from-pink-400 to-purple-400'} transition-all duration-1000`}
                          style={{ width: `${dim.score}%` }} />
                      </div>
                      <span className={`text-sm font-bold ${dim.score >= 70 ? 'text-green-500' : dim.score >= 50 ? 'text-yellow-500' : 'text-red-400'}`}>
                        {dim.score}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reasons */}
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-3">为什么匹配到TA？</h4>
              <div className="space-y-2">
                {match.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-pink-400">•</span><span>{r}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reveal Contact */}
            {!match.iRevealed ? (
              <button onClick={handleReveal} disabled={revealing}
                className="w-full py-4 text-white font-semibold bg-gradient-to-r from-pink-500 to-purple-500 rounded-2xl hover:opacity-90 transition text-lg">
                {revealing ? '确认中...' : '🤝 我愿意交换联系方式'}
              </button>
            ) : !match.partnerRevealed ? (
              <div className="text-center py-4 px-6 bg-yellow-50 rounded-2xl border border-yellow-200">
                <p className="text-yellow-700 font-medium">你已确认 ✓</p>
                <p className="text-sm text-yellow-600 mt-1">等待对方也确认后即可看到联系方式</p>
              </div>
            ) : match.contact ? (
              <div className="bg-green-50 rounded-2xl p-6 border border-green-200 text-center">
                <p className="text-green-600 font-medium mb-2">🎉 双方已确认！</p>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-sm text-gray-400">
                    {match.contact.type === 'wechat' ? '微信号' : match.contact.type === 'qq' ? 'QQ号' : '联系方式'}
                  </p>
                  <p className="text-xl font-bold text-gray-800 mt-1">{match.contact.info}</p>
                </div>
                <p className="text-xs text-green-500 mt-3">去加好友吧！聊聊看合不合拍 ☕</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-10 shadow-xl text-center animate-fade-in">
            <div className="text-6xl mb-4">🎁</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">等待本周匹配</h2>
            <p className="text-gray-500 mb-6">每周日 20:00 进行匹配<br />你的问卷已完成，坐等缘分就好～</p>
            <div className="inline-block px-6 py-3 bg-pink-50 rounded-full text-pink-600 text-sm">下周见 ✨</div>
          </div>
        )}

        {/* Match Toggle */}
        <div className="mt-8 glass-card rounded-3xl p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{matchEnabled ? '🎯' : '⏸️'}</span>
              <div>
                <h3 className="font-semibold text-gray-800">参与匹配</h3>
                <p className="text-xs text-gray-400">{matchEnabled ? '你正在参与每周匹配' : '已暂停，不会被匹配到'}</p>
              </div>
            </div>
            <button onClick={() => toggleMatch(!matchEnabled)}
              className={`w-12 h-7 rounded-full transition-colors ${matchEnabled ? 'bg-pink-500' : 'bg-gray-300'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${matchEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* Invite Codes */}
        <div className="mt-4 glass-card rounded-3xl p-6 shadow-lg">
          <button onClick={() => setShowInvite(!showInvite)} className="w-full flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📨</span>
              <div className="text-left">
                <h3 className="font-semibold text-gray-800">我的邀请码</h3>
                <p className="text-xs text-gray-400">你还剩 {inviteCodes.length} 个可用邀请码</p>
              </div>
            </div>
            <span className="text-gray-400">{showInvite ? '收起' : '展开'}</span>
          </button>
          {showInvite && (
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              {inviteCodes.length > 0 ? inviteCodes.map((c, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                  <code className="text-sm font-mono font-bold text-pink-600">{c.code}</code>
                  <button onClick={async () => { await navigator.clipboard.writeText(c.code) }}
                    className="text-xs text-gray-400 hover:text-pink-500 transition">复制</button>
                </div>
              )) : <p className="text-sm text-gray-400 text-center py-4">邀请码已用完</p>}
              <p className="text-xs text-gray-400 mt-2">邀请码发给你信任的同学，让他们也能加入吉动盲盒</p>
            </div>
          )}
        </div>

        {/* Contact Settings */}
        <div className="mt-4 glass-card rounded-3xl p-6 shadow-lg">
          <ContactSettings user={user} />
        </div>
      </div>
    </div>
  )
}

function ContactSettings({ user }: { user: any }) {
  const [contactType, setContactType] = useState('wechat')
  const [contactInfo, setContactInfo] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleSave = async () => {
    if (!contactInfo.trim()) {
      setErrorMsg('请输入联系方式')
      return
    }
    setErrorMsg('')
    setSaving(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/auth/me', {
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ contactType, contactInfo, matchEnabled: true })
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || '保存失败')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { setErrorMsg('网络错误，保存失败') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">📱</span>
        <h3 className="font-semibold text-gray-800">联系方式设置</h3>
      </div>
      <p className="text-xs text-gray-400 mb-4">匹配成功后才会展示给对方，全程加密存储</p>
      {errorMsg && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-500">
          {errorMsg}
        </div>
      )}
      <div className="flex gap-3">
        <select value={contactType} onChange={e => setContactType(e.target.value)}
          className="px-3 py-2 bg-white/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300">
          <option value="wechat">微信号</option>
          <option value="qq">QQ号</option>
          <option value="other">其他</option>
        </select>
        <input type="text" placeholder="输入你的联系方式" value={contactInfo}
          onChange={e => setContactInfo(e.target.value)}
          className="flex-1 px-4 py-2 bg-white/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
        <button onClick={handleSave} disabled={saving}
          className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl hover:opacity-90 transition">
          {saved ? '已保存 ✓' : saving ? '...' : '保存'}
        </button>
      </div>
    </div>
  )
}
