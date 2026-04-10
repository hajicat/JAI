'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const GENDER_LABELS: Record<string, string> = { male: '男', female: '女', other: '其他' }
const CONFLICT_LABELS: Record<string, string> = {
  dolphin: '🐬海豚', cat: '🐱猫', dog: '🐕犬', shark: '🦈鲨鱼'
}

// 从 cookie 获取 CSRF Token
function getCsrfToken(): string {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf-token='))
    ?.split('=')[1] || ''
}

export default function AdminPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [tab, setTab] = useState<'users' | 'codes' | 'match' | 'settings'>('users')
  const [users, setUsers] = useState<any[]>([])
  const [codes, setCodes] = useState<any[]>([])
  const [matchResult, setMatchResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [newCodeCount, setNewCodeCount] = useState(5)

  // 系统设置状态
  const [gpsRequired, setGpsRequired] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      if (!data.user?.isAdmin) { router.push('/match'); return }
      setUser(data.user)
      setLoading(false)
    }
    load()
  }, [router])

  useEffect(() => {
    if (loading) return
    if (tab === 'users') loadUsers()
    if (tab === 'codes') loadCodes()
  }, [tab, loading])

  const loadUsers = async () => {
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    setUsers(data.users || [])
  }

  const loadCodes = async () => {
    const res = await fetch('/api/admin/codes')
    const data = await res.json()
    setCodes(data.codes || [])
  }

  const generateCodes = async () => {
    setGenerating(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/codes', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ count: newCodeCount })
      })
      const data = await res.json()
      if (data.success) { loadCodes(); alert(`已生成 ${data.codes.length} 个邀请码`) }
      else alert(data.error || '生成失败')
    } catch { alert('生成失败') }
    finally { setGenerating(false) }
  }

  const runMatching = async () => {
    if (!confirm('确定执行本周匹配？匹配后不可撤销。')) return
    setGenerating(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/match', { 
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      })
      const data = await res.json()
      setMatchResult(data)
    } catch { alert('匹配失败') }
    finally { setGenerating(false) }
  }

  // 加载系统设置
  useEffect(() => {
    if (loading || tab !== 'settings') return
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(d => {
        if (d.gpsRequired !== undefined) setGpsRequired(d.gpsRequired)
      })
      .catch(() => {})
  }, [tab, loading])

  // 保存 GPS 设置
  const toggleGpsRequired = async () => {
    setSavingSettings(true)
    try {
      const csrfToken = getCsrfToken()
      const newValue = !gpsRequired
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ gpsRequired: newValue })
      })
      const data = await res.json()
      if (data.success) setGpsRequired(newValue)
      else alert(data.error || '保存失败')
    } catch { alert('保存失败') }
    finally { setSavingSettings(false) }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 via-white to-purple-50">
        <div className="text-5xl animate-bounce">🎁</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50">
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎁</span>
          <span className="font-bold text-xl gradient-text">管理后台</span>
        </div>
        <Link href="/match" className="text-sm text-pink-500 hover:underline">← 返回首页</Link>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex gap-2 mb-8">
          {[
            { key: 'users', label: '👥 用户管理', count: users.length },
            { key: 'codes', label: '📨 邀请码', count: codes.length },
            { key: 'match', label: '💌 执行匹配', count: null },
            { key: 'settings', label: '⚙️ 系统设置', count: null },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition ${
                tab === t.key ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-lg' : 'bg-white/60 text-gray-500 hover:bg-white'
              }`}>
              {t.label} {t.count !== null && `(${t.count})`}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">昵称</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">性别</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">问卷</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">冲突类型</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">参与匹配</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">剩余邀请码</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">邀请人</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">注册时间</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => (
                    <tr key={u.id} className="border-t border-gray-100 hover:bg-pink-50/50 transition">
                      <td className="px-4 py-3 font-medium text-gray-800">{u.nickname}</td>
                      <td className="px-4 py-3 text-center">{GENDER_LABELS[u.gender] || '-'}</td>
                      <td className="px-4 py-3 text-center">{u.survey_completed ? '✅' : '❌'}</td>
                      <td className="px-4 py-3 text-center">{CONFLICT_LABELS[u.conflict_type] || '-'}</td>
                      <td className="px-4 py-3 text-center">{u.match_enabled ? '🟢' : '⏸️'}</td>
                      <td className="px-4 py-3 text-center">{u.remaining_codes}</td>
                      <td className="px-4 py-3 text-gray-400">{u.invited_by_name || '管理员'}</td>
                      <td className="px-4 py-3 text-gray-400">{u.created_at}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无用户</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'codes' && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <input type="number" value={newCodeCount} onChange={e => setNewCodeCount(Number(e.target.value))} min={1} max={20}
                className="w-20 px-3 py-2 bg-white/50 border border-gray-200 rounded-xl text-sm text-center" />
              <button onClick={generateCodes} disabled={generating}
                className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl hover:opacity-90 transition">
                {generating ? '生成中...' : '+ 生成邀请码'}
              </button>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">邀请码</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">状态</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">创建者</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">使用者</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c: any, i) => (
                    <tr key={i} className="border-t border-gray-100 hover:bg-pink-50/50 transition">
                      <td className="px-4 py-3">
                        <code className="font-mono font-bold text-pink-600">{c.code}</code>
                        <button onClick={() => { navigator.clipboard.writeText(c.code); alert('已复制') }}
                          className="ml-2 text-xs text-gray-400 hover:text-pink-500">复制</button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.current_uses >= c.max_uses ? <span className="text-gray-400">已用完</span> : <span className="text-green-500 font-medium">可用</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{c.created_by_name}</td>
                      <td className="px-4 py-3 text-gray-400">{c.used_by_name || '-'}</td>
                      <td className="px-4 py-3 text-gray-400">{c.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'match' && (
          <div className="glass-card rounded-3xl p-10 text-center">
            <div className="text-6xl mb-4">💌</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">执行本周匹配</h2>
            <p className="text-gray-500 mb-6">将为所有完成问卷且开启匹配的用户进行匹配<br />支持性别偏好过滤 + 五维度加权评分 + 冲突类型分析</p>
            <button onClick={runMatching} disabled={generating}
              className="px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 disabled:opacity-50 transition shadow-lg">
              {generating ? '匹配中...' : '🎁 开始匹配'}
            </button>
            {matchResult && (
              <div className="mt-8 bg-gray-50 rounded-2xl p-6 text-left">
                <h3 className="font-bold text-gray-800 mb-3">匹配结果</h3>
                {matchResult.error ? <p className="text-red-500">{matchResult.error}</p> : (
                  <div className="space-y-2 text-sm">
                    <p>📅 匹配轮次：<strong>{matchResult.weekKey}</strong></p>
                    <p>👥 参与人数：<strong>{matchResult.totalEligible}</strong> 人</p>
                    <p>💌 成功匹配：<strong>{matchResult.matchedPairs}</strong> 对</p>
                    <p>😢 未匹配：<strong>{matchResult.unmatchedUsers}</strong> 人</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 系统设置 */}
        {tab === 'settings' && (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">⚙️ 注册设置</h3>

              <div className="flex items-center justify-between py-4 border-b border-gray-100">
                <div>
                  <p className="font-medium text-gray-800">📍 GPS 校内验证</p>
                  <p className="text-sm text-gray-400 mt-1">
                    开启后，注册时必须在吉林动画学院附近（{gpsRequired ? '当前已开启' : '当前已关闭'}）
                  </p>
                </div>
                <button
                  onClick={toggleGpsRequired}
                  disabled={savingSettings}
                  className={`w-14 h-8 rounded-full transition-colors ${gpsRequired ? 'bg-pink-500' : 'bg-gray-300'}`}
                >
                  <div
                    className={`w-6 h-6 bg-white rounded-full shadow transition-transform ${
                      gpsRequired ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="mt-4 p-4 bg-yellow-50 rounded-xl border border-yellow-200">
                <p className="text-sm text-yellow-700">
                  💡 关闭 GPS 验证后，任何人都可以注册。建议仅在测试或非校园场景下关闭。
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
