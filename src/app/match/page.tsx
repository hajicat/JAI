'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface DimScore { name: string; score: number; compatible: boolean }
interface MatchData {
  id: number; partnerId: number; partnerNickname: string
  score: number; dimScores: DimScore[] | null; reasons: string[]
  weekKey: string; iRevealed: boolean; partnerRevealed: boolean
  contact: { type: string | null; info: string | null; decryptError?: boolean; empty?: boolean } | null
  selfHasContact?: boolean
  partnerSurvey?: any // 对方的问卷回答（双方确认后返回）
}

const DIM_COLORS: Record<string, string> = {
  '价值观': 'from-purple-400 to-violet-400',
  '互动模式': 'from-green-400 to-emerald-400',
  '日常节奏': 'from-blue-400 to-cyan-400',
}

// 从 cookie 获取 CSRF Token
function getCsrfToken(): string {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf-token='))
    ?.split('=')[1] || ''
}

// 倒计时到下一个周日 20:00（北京时间）—— 匹配结果揭晓时刻
function MatchCountdown() {
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 })

  useEffect(() => {
    function update() {
      const now = new Date()

      // 目标：北京时间本周日或下周日 20:00
      // 周日 00:00~19:59 → 今天 20:00（当天揭晓）
      // 周日 20:00+     → 下周日 20:00
      // 非周日         → 本周日 20:00
      const target = new Date(now)
      const utcDay = now.getUTCDay()
      const utcHours = now.getUTCHours()

      // 北京时间 20:00 = UTC 12:00
      // 如果是 UTC 周日且已经过了 12:00（北京20:00），跳到下个周日
      if (utcDay === 0 && utcHours >= 12) {
        target.setUTCDate(target.getUTCDate() + 7)
        target.setUTCHours(12, 0, 0, 0)
      } else {
        // 否则算到这个周日的 UTC 12:00
        const daysToAdd = (7 - now.getDay()) % 7 // 周日返回 0
        target.setDate(target.getDate() + daysToAdd)
        target.setHours(20, 0, 0, 0)
      }

      const diff = target.getTime() - now.getTime()
      setCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        mins: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        secs: Math.floor((diff % (1000 * 60)) / 1000),
      })
    }

    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="inline-flex items-center gap-2 px-5 py-3 bg-pink-50 rounded-full">
      {[
        { val: countdown.days, label: '天' },
        { val: countdown.hours, label: '时' },
        { val: countdown.mins, label: '分' },
        { val: countdown.secs, label: '秒' },
      ].map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-lg font-bold text-pink-600 font-mono w-6 text-center">
            {String(item.val).padStart(2, '0')}
          </span>
          <span className="text-xs text-gray-400">{item.label}</span>
          {i < 3 && <span className="text-gray-300">:</span>}
        </div>
      ))}
    </div>
  )
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
      // 并行请求3个API，减少冷启动等待时间（~2400ms → ~800ms）
      const [meRes, matchRes, inviteRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/match'),
        fetch('/api/invite'),
      ])
      const [meData, matchData, inviteData] = await Promise.all([
        meRes.json(),
        matchRes.json(),
        inviteRes.json(),
      ])
      if (!meData.user) { router.push('/login'); return }
      if (!meData.user.isAdmin && !meData.user.surveyCompleted) { router.push('/survey'); return }
      setUser(meData.user)
      setMatchEnabled(meData.user.matchEnabled)
      if (matchData.match) {
        setMatch(matchData.match)
      }
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

  // ── 自动匹配触发 ──
  // 周日北京时间12:00之后（UTC 04:00+），第一个打开页面的已完成问卷用户触发匹配
  useEffect(() => {
    const tryAutoMatch = async () => {
      if (!user?.surveyCompleted) return

      // 检查是否在匹配窗口内（UTC 周日 04:00+ = 北京时间 12:00+）
      const now = new Date()
      const utcDay = now.getUTCDay()
      const utcHours = now.getUTCHours()
      if (utcDay !== 0 || utcHours < 4) return

      try {
        const csrfToken = getCsrfToken()

        const res = await fetch('/api/match/auto', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
        })
        const data = await res.json()

        if (data.status === 'done' || data.status === 'already_done') {
          // 匹配完成或之前已完成 → 刷新页面展示结果
          window.location.reload()
        } else if (data.status === 'in_progress') {
          // 别人正在跑 → 用 loadData 轮询而不是整页刷新，最多重试5次
          if ((window as any).__autoMatchRetries < 5) {
            ;(window as any).__autoMatchRetries = ((window as any).__autoMatchRetries || 0) + 1
            setTimeout(async () => {
              try {
                const [meRes2, matchRes2] = await Promise.all([
                  fetch('/api/auth/me'),
                  fetch('/api/match'),
                ])
                const [meData2, matchData2] = await Promise.all([meRes2.json(), matchRes2.json()])
                if (meData2.user && matchData2.match) {
                  setUser(meData2.user)
                  setMatch(matchData2.match)
                  ;(window as any).__autoMatchRetries = 99 // 停止轮询
                }
              } catch { /* ignore */ }
            }, 5000)
          }
        }
        // status === 'not_yet' 不处理（理论上不会走到这里因为上面已检查时间窗口）
      } catch {
        // 网络错误不影响使用，用户可以手动刷新页面
      }
    }

    const timer = setTimeout(tryAutoMatch, 2000) // 延迟2秒等主数据加载完
    return () => clearTimeout(timer)
  }, [user?.surveyCompleted])

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
      <nav className="flex items-center justify-between px-3 py-2.5 max-w-4xl mx-auto">
        {/* 左侧：Logo */}
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-lg shrink-0">🎁</span>
          <span className="font-bold text-base gradient-text hidden sm:inline">吉动盲盒</span>
        </div>

        {/* 右侧：操作按钮（手机端只显示图标） */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {user?.isAdmin && (
            <Link href="/admin" className="hidden sm:inline-flex px-2.5 py-1 text-xs text-pink-600 border border-pink-200 rounded-full hover:bg-pink-50 transition">管理</Link>
          )}
          <Link href="/"
            className="text-xs px-2 py-1 text-gray-500 border border-gray-200 rounded-full hover:text-pink-600 hover:border-pink-200 hover:bg-pink-50 transition"
            title="返回首页">
            🏠 首页
          </Link>
          <button onClick={handleRefresh}
            className={`text-xs px-2 py-1 border rounded-full transition ${
              refreshing ? 'animate-spin text-pink-400 border-pink-200' : 'text-pink-500 hover:text-pink-600 border-pink-200 hover:bg-pink-50'
            }`}
            title="刷新匹配结果">
            {refreshing ? '...' : '🔄'}
          </button>
          <Link href="/survey"
            className="text-xs px-2 py-1 text-purple-500 border border-purple-200 rounded-full hover:text-purple-600 hover:bg-purple-50 transition"
            title="重新测试问卷">
            📝
          </Link>
          <button onClick={handleLogout}
            className="text-xs px-2.5 py-1 text-red-400 border border-red-200 rounded-full hover:text-red-600 hover:bg-red-50 transition"
            title="退出登录">
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
              <div>
                {!match.selfHasContact && (
                  <div className="mb-3 text-center py-2 px-4 bg-orange-50 rounded-xl border border-orange-200">
                    <p className="text-sm text-orange-600">⚠️ 请先填写你自己的联系方式，才能查看对方的</p>
                  </div>
                )}
                <button onClick={handleReveal} disabled={revealing || !match.selfHasContact}
                  className={`w-full py-4 text-white font-semibold bg-gradient-to-r from-pink-500 to-purple-500 rounded-2xl transition text-lg ${
                    !match.selfHasContact ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                  }`}>
                  {revealing ? '确认中...' : '🤝 我愿意交换联系方式'}
                </button>
              </div>
            ) : !match.partnerRevealed ? (
              <div className="text-center py-4 px-6 bg-yellow-50 rounded-2xl border border-yellow-200">
                <p className="text-yellow-700 font-medium">你已确认 ✓</p>
                <p className="text-sm text-yellow-600 mt-1">等待对方也确认后即可看到联系方式</p>
              </div>
            ) : match.contact ? match.contact.empty ? (
              <div className="text-center py-4 px-6 bg-gray-50 rounded-2xl border border-gray-200">
                <p className="text-gray-500 font-medium">😅 对方暂未填写联系方式</p>
                <p className="text-xs text-gray-400 mt-1">可以等对方补充后再来查看</p>
              </div>
            ) : match.contact.decryptError ? (
              <div className="bg-green-50 rounded-2xl p-6 border border-green-200 text-center">
                <p className="text-green-600 font-medium mb-2">🎉 双方已确认！</p>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-sm text-red-400">联系方式解密失败</p>
                  <p className="text-sm text-gray-400 mt-1">请联系管理员处理</p>
                </div>
              </div>
            ) : (
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

            {/* Partner Survey Answers — 双方确认后可见 */}
            {match.iRevealed && match.partnerRevealed && match.partnerSurvey && (
              <PartnerAnswers survey={match.partnerSurvey} nickname={match.partnerNickname} />
            )}
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-10 shadow-xl text-center animate-fade-in">
            <div className="text-6xl mb-4">🔮</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">你的缘分在路上</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">
              问卷已提交，系统正在为你寻找最佳匹配<br />
              匹配结果将在每周日 <span className="font-bold text-pink-600">20:00</span> 准时揭晓
            </p>

            {/* 倒计时到揭晓时刻（周日 20:00 北京时间） */}
            <MatchCountdown />

            <div className="mt-8 flex items-center justify-center gap-4">
              <Link href="/survey"
                className="text-sm text-purple-500 hover:underline">
                📝 重新填写问卷
              </Link>
              <span className="text-gray-300">|</span>
              <Link href="/"
                className="text-sm text-gray-400 hover:underline">
                🏠 返回首页
              </Link>
            </div>
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

// === 对方问卷回答展示组件（双方确认后可见） ===
function PartnerAnswers({ survey, nickname }: { survey: any; nickname: string }) {
  const [expanded, setExpanded] = useState(false)

  // 解析多选答案
  const parseMulti = (val: string | null | undefined): string[] => {
    if (!val) return []
    try { return JSON.parse(val) } catch { return [] }
  }

  // 完整的35道题目定义（与 survey/page.tsx 保持一致）
  const questions = useMemo(() => {
    const QUESTIONS = [
      // A. 性格底色 (q1-q8)
      { key: 'q1', dim: '性格底色', type: 'choice' as const, q: '你正忙着做一件特别重要的事，旁边的人反复打断你，你最真实的第一反应更接近？' },
      { key: 'q2', dim: '性格底色', type: 'choice' as const, q: '恋爱后，对方提出"想互相知道手机密码、实时共享定位"，你更接近？' },
      { key: 'q3', dim: '性格底色', type: 'choice' as const, q: '吵架时，你最担心自己会变成哪一种？' },
      { key: 'q4', dim: '性格底色', type: 'choice' as const, q: '如果你的朋友和别人起了严重冲突，而你知道朋友不一定占理，你通常会？' },
      { key: 'q5', dim: '性格底色', type: 'choice' as const, q: '路上看到一只脏兮兮、明显状态不好的流浪猫一直跟着你叫，你第一反应更像？' },
      { key: 'q6', dim: '性格底色', type: 'choice' as const, q: '对方说"今天有点累，想自己待一会儿，不太想聊天"，你更可能？' },
      { key: 'q7', dim: '性格底色', type: 'choice' as const, q: '你在团队作业里发现，只要稍微钻点空子就能少做很多事，还不容易被发现，你更可能？' },
      { key: 'q8', dim: '性格底色', type: 'choice' as const, q: '现在生活费不算宽裕，但你特别想买一个远超自己消费能力的东西，你更可能？' },
      // B. 自我观察 (q9-q14)
      { key: 'q9', dim: '自我观察', type: 'choice' as const, q: '遇到很讨厌的人或特别委屈的事，你心里会不会冒出不太体面的想法？' },
      { key: 'q10', dim: '自我观察', type: 'choice' as const, q: '如果一定要承认自己在关系里的一个缺点，你更像？' },
      { key: 'q11', dim: '自我观察', type: 'choice' as const, q: '你做这套题的真实心态更接近？' },
      { key: 'q12', dim: '自我观察', type: 'choice' as const, q: '如果你拿到一笔 3000 元的意外收入，你更倾向？' },
      { key: 'q13', dim: '自我观察', type: 'choice' as const, q: '如果你刚决定"这笔钱先存着"，结果第二天你最喜欢的一个绝版东西出现了，而且正好花光这笔钱，你更可能？' },
      { key: 'q14', dim: '自我观察', type: 'choice' as const, q: '你不小心做错事让别人很难堪，你第一反应更像？' },
      // C. 人生方向 (q15-q21)
      { key: 'q15', dim: '人生方向', type: 'choice' as const, q: '原计划周末去学一项对自己很重要的东西，朋友突然喊你马上出去玩，你更可能？' },
      { key: 'q16', dim: '人生方向', type: 'choice' as const, q: '你更希望另一半是什么样的人？' },
      { key: 'q17', dim: '人生方向', type: 'choice' as const, q: '你更能接受哪种"有缺点但能相处"的室友？' },
      { key: 'q18', dim: '人生方向', type: 'choice' as const, q: '对热点争议事件，你通常更接近？' },
      { key: 'q19', dim: '人生方向', type: 'choice' as const, q: '两个人在一起，你最不能接受哪种"不在一个频道"？' },
      { key: 'q20', dim: '人生方向', type: 'choice' as const, q: '你更认同哪句话？' },
      { key: 'q21', dim: '人生方向', type: 'choice' as const, q: '如果有一段关系需要你改变很多，你会怎么看？' },
      // D. 相处之道 (q22-q28)
      { key: 'q22', dim: '相处之道', type: 'choice' as const, q: '对方很委屈很难过时，你下意识更像？' },
      { key: 'q23', dim: '相处之道', type: 'choice' as const, q: '你对"分享日常"的理想频率更接近？' },
      { key: 'q24', dim: '相处之道', type: 'choice' as const, q: '一起旅行时，你最理想的相处方式？' },
      { key: 'q25', dim: '相处之道', type: 'choice' as const, q: '面对严重分歧，你更像哪种状态？' },
      { key: 'q26', dim: '相处之道', type: 'choice' as const, q: '如果这次争执里你受伤了，你更可能怎么处理？' },
      { key: 'q27', dim: '相处之道', type: 'choice' as const, q: '你更能接受哪种表达爱的方式？' },
      { key: 'q28', dim: '相处之道', type: 'choice' as const, q: '当你不开心时，你更希望对方怎么做？' },
      // E. 生活节奏 (q29-q32)
      { key: 'q29', dim: '生活节奏', type: 'choice' as const, q: '你的周末通常更接近？' },
      { key: 'q30', dim: '生活节奏', type: 'choice' as const, q: '你对居住环境的要求更接近？' },
      { key: 'q31', dim: '生活节奏', type: 'choice' as const, q: '你怎么看待恋爱中的日常开销？' },
      { key: 'q32', dim: '生活节奏', type: 'choice' as const, q: '你的社交能量更像？' },
      // F. 个人画像 (q33-q35) — 开放式题目
      { key: 'q33', dim: '个人画像', type: 'multi' as const, q: '选出你觉得自己的 3 个优点（可少选）' },
      { key: 'q34', dim: '个人画像', type: 'multi' as const, q: '选出你觉得自己的 3 个缺点（可少选）' },
      { key: 'q35', dim: '个人画像', type: 'text' as const, q: '如果用一种食物来比喻你理想中的恋爱关系，会是什么？为什么？' },
    ]
    return QUESTIONS
  }, [])

  const hasContent = questions.some(q => {
    if (q.type === 'multi') return parseMulti(survey[q.key]).length > 0
    return !!survey[q.key]?.trim()
  })

  if (!hasContent) return null

  return (
    <div className="mt-6 border-t border-gray-100 pt-6">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left group">
        <h4 className="text-sm font-medium text-gray-500 group-hover:text-pink-600 transition">
          📝 查看{nickname}的问卷回答
        </h4>
        <span className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-5 animate-fade-in">
          {questions.map((q, idx) => {
            if (q.type === 'multi') {
              const items = parseMulti(survey[q.key])
              if (items.length === 0) return null
              return (
                <div key={q.key} className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="text-xs font-bold text-pink-500 bg-white px-2 py-0.5 rounded-full mt-0.5">{idx + 1}</span>
                    <p className="text-sm font-medium text-gray-800 leading-relaxed">{q.q}</p>
                  </div>
                  <p className="text-xs text-gray-400 mb-2 ml-6">✨ {q.dim} · TA 的回答</p>
                  <div className="flex flex-wrap gap-2 ml-6">
                    {items.map((item, i) => (
                      <span key={i} className="px-3 py-1.5 bg-white rounded-lg text-sm text-pink-600 font-medium shadow-sm border border-pink-100">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )
            }
            const val = survey[q.key]
            if (!val?.trim()) return null
            return (
              <div key={q.key} className="bg-gray-50 rounded-xl p-4 shadow-sm">
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-xs font-bold text-blue-500 bg-white px-2 py-0.5 rounded-full mt-0.5">{idx + 1}</span>
                  <p className="text-sm font-medium text-gray-800 leading-relaxed">{q.q}</p>
                </div>
                <p className="text-xs text-gray-400 mb-2 ml-6">💬 {q.dim} · TA 的回答</p>
                <div className="ml-6 px-4 py-3 bg-white rounded-lg border border-gray-100">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{val}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ContactSettings({ user }: { user: any }) {
  const [contactType, setContactType] = useState(user?.contactType || 'wechat')
  const [contactInfo, setContactInfo] = useState(user?.contactInfo || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // 当 user 更新时（例如重新获取数据），同步联系方式
  useEffect(() => {
    if (user?.contactType) {
      setContactType(user.contactType)
    }
    if (user?.contactInfo) {
      setContactInfo(user.contactInfo)
    }
  }, [user])

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
      <div className="flex flex-col sm:flex-row gap-2.5">
        <select value={contactType} onChange={e => setContactType(e.target.value)}
          className="px-3 py-2 bg-white/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 w-full sm:w-auto">
          <option value="wechat">微信号</option>
          <option value="qq">QQ号</option>
          <option value="other">其他</option>
        </select>
        <input type="text" placeholder="输入你的联系方式" value={contactInfo}
          onChange={e => setContactInfo(e.target.value)}
          maxLength={19}
          className="flex-1 min-w-0 px-4 py-2 bg-white/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
        <button onClick={handleSave} disabled={saving}
          className="w-full sm:w-auto px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl hover:opacity-90 transition whitespace-nowrap">
          {saved ? '已保存 ✓' : saving ? '...' : '保存'}
        </button>
      </div>
    </div>
  )
}
