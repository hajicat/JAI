'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const GENDER_LABELS: Record<string, string> = { male: '男', female: '女', other: '其他' }
const SAFETY_LABELS: Record<string, { label: string; color: string }> = {
  normal:   { label: '✅ 正常', color: 'text-green-600' },
  restricted: { label: '⚠️ 受限', color: 'text-yellow-600' },
  blocked:  { label: '🚫 封禁', color: 'text-red-600' },
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
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // 改密码状态
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [changingPw, setChangingPw] = useState(false)

  // User detail expansion state
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [userDetail, setUserDetail] = useState<any>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // 手动匹配状态
  const [manualUserA, setManualUserA] = useState<number | ''>('')
  const [manualUserB, setManualUserB] = useState<number | ''>('')
  const [manualDate, setManualDate] = useState('')        // empty = immediate (this week)
  const [manualMatching, setManualMatching] = useState(false)
  const [matchUsersForSelect, setMatchUsersForSelect] = useState<any[]>([])

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
    if (tab === 'match') loadMatchUsers()
  }, [tab, loading])

  const loadUsers = async () => {
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    setUsers(data.users || [])
  }

  const loadUserDetail = async (userId: number) => {
    // Toggle if already expanded
    if (expandedUserId === userId) { setExpandedUserId(null); return }
    setExpandedUserId(userId)
    setLoadingDetail(true)
    setUserDetail(null)
    try {
      const res = await fetch(`/api/admin/users?id=${userId}`)
      const data = await res.json()
      setUserDetail(data)
    } catch { /* ignore */ }
    finally { setLoadingDetail(false) }
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
      if (data.success) { loadCodes(); setToast({ msg: `已生成 ${data.codes.length} 个邀请码`, type: 'success' }) }
      else setToast({ msg: data.error || '生成失败', type: 'error' })
    } catch { setToast({ msg: '生成失败', type: 'error' }) }
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
    } catch { setToast({ msg: '匹配失败', type: 'error' }) }
    finally { setGenerating(false) }
  }

  // 手动指定匹配
  const runManualMatching = async () => {
    if (!manualUserA || !manualUserB) {
      setToast({ msg: '请选择两个用户', type: 'error' }); return
    }
    if (Number(manualUserA) === Number(manualUserB)) {
      setToast({ msg: '不能选择同一个用户', type: 'error' }); return
    }
    if (!confirm(`确定将这两个用户匹配到一起？${manualDate ? `\n匹配周: ${manualDate}` : '\n匹配周: 本周（立即生效）'}`)) return

    setManualMatching(true)
    try {
      const csrfToken = getCsrfToken()
      const body: any = {
        userA: Number(manualUserA),
        userB: Number(manualUserB),
      }
      if (manualDate) body.weekKey = manualDate
      const res = await fetch('/api/admin/match', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setMatchResult(data)
        setManualUserA('')
        setManualUserB('')
        setManualDate('')
        setToast({ msg: `✅ 手动匹配成功！${data.match.userAName} ↔ ${data.match.userBName} (${data.match.score}% 契合度)`, type: 'success' })
      } else {
        setToast({ msg: data.error || '匹配失败', type: 'error' })
      }
    } catch { setToast({ msg: '网络错误', type: 'error' }) }
    finally { setManualMatching(false) }
  }

  // 加载可用于匹配的用户列表（已完成问卷的）
  const loadMatchUsers = async () => {
    if (matchUsersForSelect.length > 0) return // already loaded
    try {
      const res = await fetch('/api/admin/users')
      const data = await res.json()
      // Filter to only users who completed survey
      setMatchUsersForSelect((data.users || []).filter((u: any) => u.survey_completed))
    } catch { /* ignore */ }
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
      else setToast({ msg: data.error || '保存失败', type: 'error' })
    } catch { setToast({ msg: '保存失败', type: 'error' }) }
    finally { setSavingSettings(false) }
  }

  // 修改密码
  const handleChangePassword = async () => {
    if (!currentPw || !newPw) { setToast({ msg: '请填写当前密码和新密码', type: 'error' }); return }
    if (newPw.length < 8) { setToast({ msg: '新密码至少8个字符', type: 'error' }); return }
    setChangingPw(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
      })
      const data = await res.json()
      if (data.success) {
        setToast({ msg: '✅ 密码修改成功，请重新登录', type: 'success' })
        setCurrentPw(''); setNewPw('')
      } else {
        setToast({ msg: data.error || '修改失败', type: 'error' })
      }
    } catch { setToast({ msg: '网络错误', type: 'error' }) }
    finally { setChangingPw(false) }
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
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-in ${
          toast.type === 'success' ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-red-50 text-red-500 border border-red-200'
        }`}>
          {toast.msg}
        </div>
      )}
      <nav className="flex items-center justify-between px-4 py-3 max-w-5xl mx-auto gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xl shrink-0">🎁</span>
          <span className="font-bold text-lg gradient-text truncate">管理后台</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href="/match" className="text-xs text-pink-500 hover:underline whitespace-nowrap">← 返回</Link>
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
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">安全等级</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">参与匹配</th>
                    <th className="px-4 py-3 text-center text-gray-500 font-medium">剩余邀请码</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">邀请人</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium">注册时间</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => (
                    <>
                      <tr key={u.id} onClick={() => loadUserDetail(u.id)}
                        className={`border-t border-gray-100 cursor-pointer transition ${expandedUserId === u.id ? 'bg-pink-50' : 'hover:bg-pink-50/50'}`}>
                        <td className="px-4 py-3 font-medium text-gray-800 flex items-center gap-2">
                          {u.nickname}
                          {expandedUserId === u.id && (
                            <span className="text-xs text-pink-400">▼ 详情已展开</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">{GENDER_LABELS[u.gender] || '-'}</td>
                        <td className="px-4 py-3 text-center">{u.survey_completed ? '✅' : '❌'}</td>
                        <td className={`px-4 py-3 text-center font-medium ${SAFETY_LABELS[u.safety_level || 'normal']?.color || ''}`}>
                          {SAFETY_LABELS[u.safety_level || 'normal']?.label || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">{u.match_enabled ? '🟢' : '⏸️'}</td>
                        <td className="px-4 py-3 text-center">{u.remaining_codes}</td>
                        <td className="px-4 py-3 text-gray-400">{u.invited_by_name || '管理员'}</td>
                        <td className="px-4 py-3 text-gray-400">{u.created_at}</td>
                      </tr>
                      {/* Expanded detail row */}
                      {expandedUserId === u.id && (
                        <tr key={`${u.id}-detail`}>
                          <td colSpan={8} className="px-0 py-0 bg-pink-50/30">
                            <div className="p-5 border-t border-pink-100">
                              {loadingDetail ? (
                                <p className="text-center text-gray-400 py-4">加载中...</p>
                              ) : userDetail?.error ? (
                                <p className="text-red-500 text-center py-2">{userDetail.error}</p>
                              ) : userDetail?.user ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                  {/* Left: Basic info & contact */}
                                  <div className="space-y-4">
                                    <h4 className="font-bold text-gray-700 text-sm border-b pb-2">基本信息 & 联系方式</h4>

                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                      <div><span className="text-gray-400">邮箱：</span>{userDetail.user.email}</div>
                                      <div><span className="text-gray-400">想匹配：</span>{GENDER_LABELS[userDetail.user.preferredGender]}</div>
                                      <div><span className="text-gray-400">注册时间：</span>{userDetail.user.createdAt}</div>
                                    </div>

                                    {userDetail.user.contactInfo ? (
                                      <div className="mt-2 p-3 bg-white rounded-xl border border-green-200">
                                        <p className="text-xs text-green-600 font-medium mb-1">📱 联系方式（解密）</p>
                                        <p className="font-mono text-sm text-gray-800">
                                          {userDetail.user.contactType === 'wechat' ? '微信号：'
                                            : userDetail.user.contactType === 'qq' ? 'QQ号：'
                                            : ''}{userDetail.user.contactInfo}
                                        </p>
                                        <button onClick={() => navigator.clipboard.writeText(userDetail.user.contactInfo)}
                                          className="mt-1 text-xs text-green-500 hover:underline">复制</button>
                                      </div>
                                    ) : (
                                      <div className="mt-2 p-3 bg-gray-100 rounded-xl text-sm text-gray-400">
                                        暂未设置联系方式
                                      </div>
                                    )}
                                  </div>

                                  {/* Right: Survey answers */}
                                  <div className="space-y-4">
                                    <h4 className="font-bold text-gray-700 text-sm border-b pb-2">问卷答题记录
                                      <span className="ml-2 text-xs font-normal text-gray-400">
                                        {userDetail.survey ? `共 ${Object.keys(userDetail.survey).filter(k => k.startsWith('q')).length}/32 题` : '未完成'}
                                      </span>
                                    </h4>

                                    {!userDetail.survey ? (
                                      <p className="text-gray-400 text-sm">用户尚未完成问卷</p>
                                    ) : (
                                      <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
                                        {/* Group by dimension */}
                                        {(function() {
                                          const DIMS = [
                                            { name: '🛡️ 安全门槛', qs: ['q1','q2','q3','q4','q5','q6','q7','q8'] },
                                            { name: '🔍 真实性检测', qs: ['q9','q10','q11','q12','q13','q14'] },
                                            { name: '🧭 价值观', qs: ['q15','q16','q17','q18','q19','q20','q21'] },
                                            { name: '💬 互动模式', qs: ['q22','q23','q24','q25','q26','q27','q28'] },
                                            { name: '🏠 日常节奏', qs: ['q29','q30','q31','q32'] },
                                          ]
                                          const Q_TEXTS: Record<string, string> = {
                                            // 安全门槛
                                            q1:'正忙时被打断，第一反应？', q2:'对方要求共享密码定位，你倾向？',
                                            q3:'吵架最担心变成哪种？', q4:'朋友不占理起冲突，你通常？',
                                            q5:'流浪猫跟着你叫，第一反应？', q6:'对方说想独处，你更可能？',
                                            q7:'钻空子少做事还不被发现，你会？', q8:'想买超预算的东西，你更可能？',
                                            // 真实性检测
                                            q9:'心里会不会冒出不太体面的想法？', q10:'承认一个缺点，你更像？',
                                            q11:'做这套题的真实心态？', q12:'3000元意外收入，你倾向？',
                                            q13:'刚决定存钱，绝版东西出现，你？', q14:'做错事让别人难堪，第一反应？',
                                            // 价值观
                                            q15:'原计划学习 vs 朋友喊玩，你？', q16:'希望另一半是什么样的人？',
                                            q17:'能接受哪种有缺点的室友？', q18:'对热点争议事件，你通常？',
                                            q19:'最不能接受哪种"不在一个频道"？', q20:'更认同哪句话（关系观）？',
                                            q21:'关系需要改变很多，你怎么看？',
                                            // 互动/冲突
                                            q22:'对方委屈难过时，下意识更像？', q23:'分享日常的理想频率？',
                                            q24:'旅行时的理想相处方式？', q25:'面对严重分歧更像哪种状态？',
                                            q26:'争执中受伤了，怎么处理？(核心)', q27:'更能接受哪种表达爱的方式？',
                                            q28:'不开心时希望对方怎么做？',
                                            // 日常节奏
                                            q29:'周末通常更接近？', q30:'对居住环境的要求？',
                                            q31:'恋爱中的日常开销看法？', q32:'社交能量更像？',
                                          }
                                          return DIMS.map(dim => {
                                            const answered = dim.qs.filter(q => userDetail.survey[q])
                                            if (answered.length === 0) return null
                                            return (
                                              <details key={dim.name} className="group" open>
                                                <summary className="cursor-pointer text-xs font-semibold text-gray-600 hover:text-pink-500 transition select-none">
                                                  {dim.name} ({answered.length}/{dim.qs.length})
                                                </summary>
                                                <div className="pl-3 mt-1 space-y-1.5">
                                                  {dim.qs.map(q => !userDetail.survey[q] ? null : (
                                                    <div key={q} className="text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                                                      <p className="text-gray-400 mb-0.5">{Q_TEXTS[q]?.replace(/⭐.*$/, '')}</p>
                                                      <p className="font-medium text-gray-700">{userDetail.survey[q]}</p>
                                                    </div>
                                                  ))}
                                                </div>
                                              </details>
                                            )
                                          })
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
                        <button onClick={async () => { await navigator.clipboard.writeText(c.code) }}
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
          <div className="space-y-6">
            {/* ── 手动指定匹配 ── */}
            <div className="glass-card rounded-3xl p-8">
              <h2 className="text-xl font-bold text-gray-800 mb-1">🔗 手动指定匹配</h2>
              <p className="text-sm text-gray-400 mb-6">选择两个已完成问卷的用户进行配对，用于测试或特殊情况</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                {/* User A */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">用户 A</label>
                  <select value={manualUserA} onChange={e => setManualUserA(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300">
                    <option value="">— 选择用户 —</option>
                    {matchUsersForSelect.map((u: any) => (
                      <option key={u.id} value={u.id} disabled={Number(manualUserB) === u.id}>
                        {u.nickname} ({GENDER_LABELS[u.gender] || '?'}){Number(manualUserB) === u.id ? ' ← 已选为B' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* User B */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">用户 B</label>
                  <select value={manualUserB} onChange={e => setManualUserB(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300">
                    <option value="">— 选择用户 —</option>
                    {matchUsersForSelect.map((u: any) => (
                      <option key={u.id} value={u.id} disabled={Number(manualUserA) === u.id}>
                        {u.nickname} ({GENDER_LABELS[u.gender] || '?'}){Number(manualUserA) === u.id ? ' ← 已选为A' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date (optional) */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">匹配时间（可选）</label>
                  <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                    placeholder="留空 = 本周" />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button onClick={runManualMatching}
                  disabled={manualMatching || !manualUserA || !manualUserB}
                  className={`px-6 py-2.5 text-sm font-semibold rounded-xl transition ${
                    manualMatching || !manualUserA || !manualUserB
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:opacity-90 shadow-md'
                  }`}>
                  {manualMatching ? '⏳ 匹配中...' : '🔗 立即配对'}
                </button>
                {manualDate && (
                  <span className="text-xs text-gray-400">将写入 {manualDate} 所属周 ({(() => {
                    const d = new Date(manualDate + 'T00:00:00')
                    const start = new Date(d.getFullYear(), 0, 1)
                    const diff = d.getTime() - start.getTime()
                    return `${d.getFullYear()}-W${String(Math.ceil(diff / (7*24*60*60*1000))).padStart(2,'0')}`
                  })()})</span>
                )}
                {!manualDate && (
                  <span className="text-xs text-green-500">✓ 立即生效（本周）</span>
                )}
              </div>
            </div>

            {/* 分割线 */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 font-medium">或使用全自动匹配</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* ── 原有：自动匹配 ── */}
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
                {matchResult.error ? (
                  <p className="text-red-500">{matchResult.error}</p>
                ) : matchResult.manual ? (
                  <div className="space-y-2 text-sm">
                    <p>📅 匹配周：<strong>{matchResult.weekKey}</strong></p>
                    <p>🔗 <strong>{matchResult.match?.userAName}</strong> ↔ <strong>{matchResult.match?.userBName}</strong></p>
                    <p>💯 契合度：<strong className="text-pink-600">{matchResult.match?.score}%</strong></p>
                  </div>
                ) : (
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

            {/* 修改密码 */}
            <div className="glass-card rounded-2xl p-6 mt-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">🔐 修改管理员密码</h3>
              <div className="space-y-3 max-w-md">
                <input type="password" placeholder="当前密码" value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                  disabled={changingPw} />
                <input type="password" placeholder="新密码（至少8位，含字母和数字）" value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                  disabled={changingPw} />
                <button onClick={handleChangePassword}
                  disabled={changingPw || !currentPw || !newPw}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl hover:opacity-90 disabled:opacity-50 transition">
                  {changingPw ? '修改中...' : '确认修改密码'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
