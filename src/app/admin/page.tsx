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
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // User detail expansion state
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [userDetail, setUserDetail] = useState<any>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

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
                        <td className="px-4 py-3 text-center">{CONFLICT_LABELS[u.conflict_type] || '-'}</td>
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
                                        {userDetail.survey ? `共 ${Object.keys(userDetail.survey).filter(k => k.startsWith('q')).length}/31 题` : '未完成'}
                                      </span>
                                    </h4>

                                    {!userDetail.survey ? (
                                      <p className="text-gray-400 text-sm">用户尚未完成问卷</p>
                                    ) : (
                                      <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
                                        {/* Group by dimension */}
                                        {(function() {
                                          const DIMS = [
                                            { name: '🛡️ 安全联结', qs: ['q1','q2','q3','q4','q5','q6'] },
                                            { name: '💬 互动模式', qs: ['q7','q8','q9','q10','q11','q12'] },
                                            { name: '🧭 意义系统', qs: ['q13','q14','q15','q16','q17','q18'] },
                                            { name: '🚀 动力发展', qs: ['q19','q20','q21','q22','q23','q24'] },
                                            { name: '🏠 日常系统', qs: ['q25','q26','q27','q28','q29','q30','q31'] },
                                          ]
                                          const Q_TEXTS: Record<string, string> = {
                                            q1:'你最认同哪种「爱的安全感」来源？', q2:'以下哪个瞬间最让你感到「被爱」？',
                                            q3:'当感觉对方在疏远你时，你通常会？', q4:'你对「过去的感情经历」的态度是？',
                                            q5:'你的回复速度通常是？', q6:'和喜欢的人在一起时你更享受？',
                                            q7:'面对冲突时，你更像哪种动物？⭐(决定冲突类型)', q8:'吵架时你最容易脱口而出的话是？',
                                            q9:'你心情不好时最希望伴侣怎么做？', q10:'你对「冷战」的态度是？',
                                            q11:'你对「分享日常」的态度是？', q12:'你对「说我爱你」的频率期待是？',
                                            q13:'在关系中你最看重对方给你的？', q14:'以下哪句话最能打动你？',
                                            q15:'你对「三观一致」的看法是？', q16:'你的人生优先级是？',
                                            q17:'你对「门当户对」的看法是？', q18:'你愿意为伴侣改变自己吗？',
                                            q19:'当你压力很大时，你最需要伴侣？', q20:'你对「两个人一起成长」的期待是？',
                                            q21:'你对「金钱观」的态度是？', q22:'你介意伴侣的消费习惯和你不同吗？',
                                            q23:'你更喜欢和什么样的人相处？', q24:'你理想的关系模式是？',
                                            q25:'你的日常作息是？', q26:'周末你更喜欢？',
                                            q27:'你对卫生整洁的要求？', q28:'你对饮食的态度是？',
                                            q29:'生活习惯差异对恋爱的影响？', q30:'你对手机依赖的看法？',
                                            q31:'当有重要的事想和对方说，你更倾向于？',
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
