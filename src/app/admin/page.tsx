'use client'

import { useState, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { dateToWeekKey } from '@/lib/week'
import { getCsrfToken } from '@/lib/csrf'

// 安全复制到剪贴板（兼容非 HTTPS 环境）
const safeCopy = async (text: string): Promise<boolean> => {
  try {
    if (navigator?.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    // fallback: 用 textarea 方式（兼容 HTTP / IP 访问）
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}

const GENDER_LABELS: Record<string, string> = { male: '男', female: '女', other: '其他' }
const SAFETY_LABELS: Record<string, { label: string; color: string }> = {
  normal:   { label: '✅ 正常', color: 'text-green-600' },
  restricted: { label: '⚠️ 受限', color: 'text-yellow-600' },
  blocked:  { label: '🚫 封禁', color: 'text-red-600' },
}

// 将数据库 UTC 时间字符串转为北京时间（UTC+8）格式化显示
function formatBeijingTime(utcStr: string | null | undefined): string {
  if (!utcStr) return '-'
  try {
    const d = new Date(utcStr + (utcStr.endsWith('Z') ? '' : 'Z'))
    if (isNaN(d.getTime())) return String(utcStr)
    const pad = (n: number) => String(n).padStart(2, '0')
    const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000)
    return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`
  } catch {
    return String(utcStr)
  }
}

// getCsrfToken 已从 @/lib/csrf 导入

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
  const [inviteRequired, setInviteRequired] = useState(true)
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
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null)  // 删除中状态

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalUserCount, setTotalUserCount] = useState(0)

  // 二级密码验证弹窗状态
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<number | null>(null)
  const [verifyPassword, setVerifyPassword] = useState('')
  const [verifyingPw, setVerifyingPw] = useState(false)
  const [verifyError, setVerifyError] = useState('')

  // 独立二级密码设置状态（系统设置tab）
  const [viewPwInput, setViewPwInput] = useState('')
  const [viewPwConfirm, setViewPwConfirm] = useState('')
  const [viewPwCurrent, setViewPwCurrent] = useState('') // 当前密码（修改时需要）
  const [settingViewPw, setSettingViewPw] = useState(false)
  const [hasViewPassword, setHasViewPassword] = useState<boolean | null>(null) // null=未加载

  // 手动匹配状态
  const [manualUserA, setManualUserA] = useState<number | ''>('')
  const [manualUserB, setManualUserB] = useState<number | ''>('')
  const [manualDate, setManualDate] = useState('')        // empty = immediate (this week)
  const [manualMatching, setManualMatching] = useState(false)
  const [resettingMatch, setResettingMatch] = useState(false)
  const [matchUsersForSelect, setMatchUsersForSelect] = useState<any[]>([])

  // 匹配结果详情（分页列表，需二级密码验证）
  const [matchDetailVerified, setMatchDetailVerified] = useState(false)    // 是否已通过二级密码验证
  const [showMatchPwModal, setShowMatchPwModal] = useState(false)          // 匹配详情密码弹窗
  const [matchVerifyPassword, setMatchVerifyPassword] = useState('')
  const [matchVerifyingPw, setMatchVerifyingPw] = useState(false)
  const [matchVerifyError, setMatchVerifyError] = useState('')
  const [matchPairs, setMatchPairs] = useState<any[]>([])
  const [matchUnmatched, setMatchUnmatched] = useState<any[]>([])
  const [matchTotalPairs, setMatchTotalPairs] = useState(0)
  const [matchPage, setMatchPage] = useState(1)
  const MATCH_PAGE_SIZE = 10
  const [loadingMatchDetails, setLoadingMatchDetails] = useState(false)
  // 历史周选择（用于查看非当前周的配对记录）
  const [adminSelectedWeek, setAdminSelectedWeek] = useState<string>('')
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([])

  // 手动匹配状态

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

  // 检查是否已设置二级密码（页面首次加载时）
  const [viewPwChecked, setViewPwChecked] = useState(false)
  useEffect(() => {
    fetch('/api/admin/set-view-password')
      .then(r => r.json())
      .then(data => { if ('hasPassword' in data) { setHasViewPassword(data.hasPassword); setViewPwChecked(true) } })
      .catch(() => {})
  }, [])

  const loadUsers = async (page: number = 1) => {
    const res = await fetch(`/api/admin/users?page=${page}`)
    const data = await res.json()
    setUsers(data.users || [])
    if (data.pagination) {
      setCurrentPage(data.pagination.page)
      setTotalPages(data.pagination.totalPages)
      setTotalUserCount(data.pagination.totalCount)
    }
    // 切页时关闭已展开的详情
    setExpandedUserId(null)
    setUserDetail(null)
  }

  /** 触发查看用户详情：先检查是否已设置二级密码 */
  const requestUserDetail = async (userId: number) => {
    if (expandedUserId === userId) { setExpandedUserId(null); return }

    // 还在加载中（首次请求尚未返回）→ 等一下再判断
    if (hasViewPassword === null) {
      setToast({ msg: '⏳ 正在检查密码设置状态，请稍后再试', type: 'error' })
      return
    }

    // 已确认没有设置二级密码 → 跳到系统设置页提示去设置
    if (!hasViewPassword) {
      setTab('settings')
      setToast({ msg: '⚠️ 请先在下方「查看详情二级密码」区域设置密码', type: 'error' })
      return
    }

    setPendingUserId(userId)
    setVerifyPassword('')
    setVerifyError('')
    setShowPasswordModal(true)
  }

  /** 密码验证通过后，真正加载用户详情 */
  const loadUserDetail = async (userId: number) => {
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

  // 删除用户密码确认状态
  const [deletePwModal, setDeletePwModal] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [deletePw, setDeletePw] = useState('')
  const [deletePwError, setDeletePwError] = useState('')
  const [deletingConfirmed, setDeletingConfirmed] = useState(false)

  /** 删除用户（需在已通过二级密码验证的用户详情页操作） */
  const handleDeleteUser = async (userId: number) => {
    if (!confirm('⚠️ 确定要删除此用户？此操作不可撤销！\n\n将同时删除：\n- 问卷回答\n- 匹配记录\n- 验证码记录\n- 未使用的邀请码')) return

    setPendingDeleteId(userId)
    setDeletePw('')
    setDeletePwError('')
    setDeletePwModal(true)
  }

  /** 确认删除（已输入二级密码） */
  const handleConfirmDelete = async () => {
    if (!deletePw.trim()) { setDeletePwError('请输入管理员密码'); return }
    const userId = pendingDeleteId
    if (userId == null) return

    setDeletingConfirmed(true)
    setDeletePwError('')
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch(`/api/admin/users?id=${userId}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmPassword: deletePw }),
      })
      const data = await res.json()
      if (data.success) {
        setDeletePwModal(false)
        setToast({ msg: `✅ ${data.message}`, type: 'success' })
        setExpandedUserId(null)
        setUserDetail(null)
        loadUsers(currentPage)
      } else {
        setDeletePwError(data.error || '删除失败')
      }
    } catch {
      setDeletePwError('网络错误，删除失败')
    } finally {
      setDeletingConfirmed(false)
    }
  }

  /** 提交密码验证（独立二级密码） */
  const handleVerifyPassword = async () => {
    if (!verifyPassword.trim()) { setVerifyError('请输入密码'); return }
    setVerifyingPw(true)
    setVerifyError('')
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ password: verifyPassword }),
      })
      const data = await res.json()
      if (data.valid) {
        setShowPasswordModal(false)
        if (pendingUserId !== null) loadUserDetail(pendingUserId)
      } else if (data.needSetup) {
        // 还没设置过二级密码 → 关闭验证弹窗，跳到设置页
        setShowPasswordModal(false)
        setTab('settings')
        setToast({ msg: '⚠️ 请先设置查看详情密码', type: 'error' })
      } else {
        setVerifyError(data.message || '密码错误')
      }
    } catch {
      setVerifyError('网络错误，请重试')
    } finally {
      setVerifyingPw(false)
    }
  }

  /** 设置/修改独立二级密码 */
  const handleSetViewPassword = async () => {
    if (!viewPwInput) { setToast({ msg: '请输入密码', type: 'error' }); return }
    if (viewPwInput.length < 8) { setToast({ msg: '密码至少8位，含字母和数字', type: 'error' }); return }
    if (hasViewPassword && !viewPwCurrent) { setToast({ msg: '请输入当前密码', type: 'error' }); return }
    if (hasViewPassword && !viewPwConfirm) { setToast({ msg: '请确认新密码', type: 'error' }); return }
    if (viewPwInput !== viewPwConfirm && hasViewPassword) { setToast({ msg: '两次新密码不一致', type: 'error' }); return }
    setSettingViewPw(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/set-view-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({
          password: viewPwInput,
          ...(hasViewPassword ? { currentPassword: viewPwCurrent } : {}),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setToast({ msg: hasViewPassword ? '✅ 二级密码已更新' : '✅ 二级密码已设置', type: 'success' })
        setViewPwInput(''); setViewPwConfirm(''); setViewPwCurrent('')
        setHasViewPassword(true)
      } else {
        setToast({ msg: data.error || '设置失败', type: 'error' })
      }
    } catch {
      setToast({ msg: '网络错误', type: 'error' })
    } finally {
      setSettingViewPw(false)
    }
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
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ action: 'auto' }),
      })
      const data = await res.json()
      setMatchResult(data)
    } catch { setToast({ msg: '匹配失败', type: 'error' }) }
    finally { setGenerating(false) }
  }

  // 重置本周匹配（清除锁 + 删除已有匹配记录，允许重新匹配）
  const handleResetMatch = async () => {
    if (!confirm('⚠️ 确定重置本周匹配？这将删除本周所有匹配记录并释放锁，用户可以重新被匹配！')) return
    setResettingMatch(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/reset-match', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      })
      const data = await res.json()
      if (data.success) {
        setToast({ msg: '✅ 已重置本周匹配，可重新执行', type: 'success' })
        setMatchResult(null)
        setMatchDetailVerified(false)
        // 刷新状态
        fetch('/api/admin/match-status').then(r => r.json()).catch(() => {})
      } else {
        setToast({ msg: data.error || '重置失败', type: 'error' })
      }
    } catch { setToast({ msg: '网络错误', type: 'error' }) }
    finally { setResettingMatch(false) }
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
        action: 'manual',
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

  // 加载可用于匹配的用户列表（已完成问卷的）— 首次加载后可手动刷新
  const [matchUsersLoaded, setMatchUsersLoaded] = useState(false)

  const loadMatchUsers = async (forceRefresh = false) => {
    if (!forceRefresh && matchUsersLoaded) return // 已加载且不强制刷新时跳过
    try {
      const res = await fetch('/api/admin/users?all=1')
      const data = await res.json()
      setMatchUsersForSelect((data.users || []).filter((u: any) => u.survey_completed))
      setMatchUsersLoaded(true)
    } catch { /* ignore */ }
  }

  // ── 检测本周是否已执行过自动匹配（用户端触发的也能显示）──
  useEffect(() => {
    if (loading || tab !== 'match') return
    // 检查是否有匹配结果（调用一个轻量接口）
    fetch('/api/admin/match-status')
      .then(r => r.json())
      .then(data => {
        if (data.matched) {
          // 本周已匹配 → 显示结果摘要
          setMatchResult({
            weekKey: data.weekKey,
            matchedPairs: data.matchedPairs,
            totalEligible: data.totalEligible,
            unmatchedUsers: data.unmatchedUsers,
          })
        } else {
          // 未匹配 → 清空旧结果
          setMatchResult(null)
        }
      })
      .catch(() => {})
  }, [tab, loading])

  // ── 匹配结果详情（需二级密码验证 + 分页）──
  const requestMatchDetail = async () => {
    if (matchDetailVerified) { setMatchDetailVerified(false); return }
    if (!hasViewPassword) {
      setTab('settings')
      setToast({ msg: '⚠️ 请先设置查看详情二级密码', type: 'error' })
      return
    }
    setMatchVerifyPassword('')
    setMatchVerifyError('')
    setShowMatchPwModal(true)
  }

  const handleMatchVerifyPassword = async () => {
    if (!matchVerifyPassword.trim()) { setMatchVerifyError('请输入密码'); return }
    setMatchVerifyingPw(true)
    setMatchVerifyError('')
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ password: matchVerifyPassword }),
      })
      const data = await res.json()
      if (data.valid) {
        setShowMatchPwModal(false)
        setMatchDetailVerified(true)
        setMatchPage(1)
        await loadMatchDetails(1, adminSelectedWeek)
      } else if (data.needSetup) {
        setShowMatchPwModal(false); setTab('settings');
        setToast({ msg: '⚠️ 请先设置查看详情密码', type: 'error' })
      } else {
        setMatchVerifyError(data.message || '密码错误')
      }
    } catch { setMatchVerifyError('网络错误，请重试') }
    finally { setMatchVerifyingPw(false) }
  }

  const loadMatchDetails = async (page: number = 1, week?: string) => {
    setLoadingMatchDetails(true)
    try {
      const targetWeek = week || adminSelectedWeek || ''
      const url = `/api/admin/matches?page=${page}&limit=${MATCH_PAGE_SIZE}${targetWeek ? `&week=${encodeURIComponent(targetWeek)}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      setMatchPairs(data.pairs || [])
      setMatchUnmatched(data.unmatched || [])
      setMatchTotalPairs(data.totalPairs || 0)
      // 如果后端返回了可用周列表，缓存起来
      if (data.availableWeeks) setAvailableWeeks(data.availableWeeks)
    } catch { /* ignore */ }
    finally { setLoadingMatchDetails(false) }
  }

  const matchTotalPages = Math.ceil(matchTotalPairs / MATCH_PAGE_SIZE)

  // ── 匹配结果详情（需二级密码验证 + 分页）──

  useEffect(() => {
    if (loading || tab !== 'settings') return
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(d => {
        if (d.gpsRequired !== undefined) setGpsRequired(d.gpsRequired)
        if (d.inviteRequired !== undefined) setInviteRequired(d.inviteRequired)
      })
      .catch(() => {})

    // 检查二级密码是否已设置
    fetch('/api/admin/set-view-password')
      .then(r => r.json())
      .then(d => { if ('hasPassword' in d) setHasViewPassword(d.hasPassword) })
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

  // 保存邀请码设置
  const toggleInviteRequired = async () => {
    setSavingSettings(true)
    try {
      const csrfToken = getCsrfToken()
      const newValue = !inviteRequired
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ inviteRequired: newValue })
      })
      const data = await res.json()
      if (data.success) setInviteRequired(newValue)
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
            { key: 'users', label: '👥 用户管理', count: totalUserCount || users.length },
            ...(inviteRequired ? [{ key: 'codes', label: '📨 邀请码', count: codes.length }] : []),
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
              <table className="w-full text-sm table-fixed" style={{ minWidth: '700px' }}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium" style={{width:'14%'}}>昵称</th>
                    <th className="px-2 py-3 text-center text-gray-500 font-medium" style={{width:'5%'}}>性别</th>
                    <th className="px-2 py-3 text-center text-gray-500 font-medium" style={{width:'5%'}}>问卷</th>
                    <th className="px-2 py-3 text-center text-gray-500 font-medium" style={{width:'7%'}}>安全等级</th>
                    <th className="px-2 py-3 text-center text-gray-500 font-medium" style={{width:'5%'}}>参与匹配</th>
                    <th className="px-2 py-3 text-center text-gray-500 font-medium" style={{width:'7%'}}>学生验证</th>
                    <th className="px-2 py-3 text-center text-gray-500 font-medium" style={{width:'9%'}}>剩余邀请码</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium" style={{width:'13%'}}>邀请人</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium" style={{width:'15%'}}>注册时间</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => (
                    <Fragment key={u.id}>

                      <tr key={u.id} onClick={() => requestUserDetail(u.id)}
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
                        {/* 学生验证 — 无密码也能看到 */}
                        <td className={`px-4 py-3 text-center text-xs font-medium ${u._verifyLabel?.color || 'text-gray-400'}`}>
                          {u._verifyLabel?.label || '—'}
                          {typeof u.verification_score === 'number' && (
                            <span className="ml-0.5 text-gray-400 font-normal">({u.verification_score})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">{u.remaining_codes}</td>
                        <td className="px-4 py-3 text-gray-400">{u.invited_by_name || '管理员'}</td>
                        <td className="px-4 py-3 text-gray-400">{formatBeijingTime(u.created_at)}</td>
                      </tr>
                      {/* Expanded detail row */}
                      {expandedUserId === u.id && (
                        <tr key={`${u.id}-detail`}>
                          <td colSpan={9} className="px-0 py-0 bg-pink-50/30">
                            <div className="p-5 border-t border-pink-100">
                              {/* 删除用户按钮 */}
                              <div className="flex justify-end mb-3">
                                <button
                                  onClick={() => handleDeleteUser(u.id)}
                                  disabled={deletingUserId === u.id}
                                  className="text-xs font-medium px-4 py-2 rounded-lg border transition
                                    disabled:opacity-50 disabled:cursor-not-allowed
                                    text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300"
                                >
                                  {deletingUserId === u.id ? '⏳ 删除中...' : '🗑️ 删除此用户'}
                                </button>
                              </div>
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
                                      <div><span className="text-gray-400">邮箱：</span>{userDetail.user.email || '-'}</div>
                                      <div><span className="text-gray-400">想匹配：</span>{GENDER_LABELS[userDetail.user.preferredGender] || '-'}</div>
                                      <div><span className="text-gray-400">注册时间：</span>{formatBeijingTime(userDetail.user.createdAt)}</div>
                                      {/* 学生验证状态 */}
                                      <div>
                                        <span className="text-gray-400">学生验证：</span>
                                        {userDetail.user.verificationStatus === 'verified_student' ? (
                                          <span className="text-green-600 font-medium">✅ 已验证（{userDetail.user.verificationScore}分）</span>
                                        ) : userDetail.user.verificationStatus === 'pending_verification' ? (
                                          <span className="text-yellow-600 font-medium">⏳ 待验证（{userDetail.user.verificationScore ?? 0}分）</span>
                                        ) : userDetail.user.verificationStatus === 'verification_failed' ? (
                                          <span className="text-red-500 font-medium">❌ 未通过</span>
                                        ) : (
                                          <span className="text-gray-400">—</span>
                                        )}
                                        {userDetail.user.verifiedAt && (
                                          <span className="text-xs text-gray-400 ml-1">通过时间：{formatBeijingTime(userDetail.user.verifiedAt)}</span>
                                        )}
                                      </div>
                                    </div>

                                    {userDetail.user.contactInfo ? (
                                      <div className="mt-2 p-3 bg-white rounded-xl border border-green-200">
                                        <p className="text-xs text-green-600 font-medium mb-1">📱 联系方式（解密）</p>
                                        <p className="font-mono text-sm text-gray-800">
                                          {userDetail.user.contactType === 'wechat' ? '微信号：'
                                            : userDetail.user.contactType === 'qq' ? 'QQ号：'
                                            : ''}{userDetail.user.contactInfo}
                                        </p>
                                        <button onClick={async () => { const ok = await safeCopy(userDetail.user.contactInfo); if (!ok) setToast({ msg: '复制失败', type: 'error' }) }}
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
                    </Fragment>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">暂无用户</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 分页导航 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50/50 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  共 {totalUserCount} 人，第 {currentPage}/{totalPages} 页
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => loadUsers(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed bg-white border border-gray-200 text-gray-600 hover:bg-pink-50 hover:border-pink-200 hover:text-pink-600">
                    ← 上一页
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => {
                      // 始终显示首尾页和当前页附近
                      if (p === 1 || p === totalPages) return true
                      if (p >= currentPage - 1 && p <= currentPage + 1) return true
                      return false
                    })
                    .map((p, idx, arr) => (
                      <Fragment key={p}>
                        {idx > 0 && arr[idx - 1] !== p - 1 && (
                          <span className="w-8 h-7 flex items-center justify-center text-xs text-gray-400">…</span>
                        )}
                        <button
                          onClick={() => p !== currentPage && loadUsers(p)}
                          className={`w-8 h-7 text-xs font-medium rounded-lg transition ${
                            p === currentPage
                              ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow'
                              : 'bg-white border border-gray-200 text-gray-600 hover:bg-pink-50 hover:border-pink-200'
                          }`}>
                          {p}
                        </button>
                      </Fragment>
                    ))}
                  <button
                    onClick={() => loadUsers(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed bg-white border border-gray-200 text-gray-600 hover:bg-pink-50 hover:border-pink-200 hover:text-pink-600">
                    下一页 →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'codes' && inviteRequired && (
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
                        <button onClick={async () => { const ok = await safeCopy(c.code); if (!ok) setToast({ msg: '复制失败', type: 'error' }) }}
                          className="ml-2 text-xs text-gray-400 hover:text-pink-500">复制</button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.current_uses >= c.max_uses ? <span className="text-gray-400">已用完</span> : <span className="text-green-500 font-medium">可用</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{c.created_by_name}</td>
                      <td className="px-4 py-3 text-gray-400">{c.used_by_name || '-'}</td>
                      <td className="px-4 py-3 text-gray-400">{formatBeijingTime(c.created_at)}</td>
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
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl font-bold text-gray-800">🔗 手动指定匹配</h2>
                <button
                  onClick={() => loadMatchUsers(true)}
                  className="text-xs px-3 py-1 text-pink-500 border border-pink-200 rounded-full hover:bg-pink-50 transition"
                >
                  🔄 刷新用户列表
                </button>
              </div>
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
                  <span className="text-xs text-gray-400">将写入 {dateToWeekKey(manualDate)}</span>
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
              <div className="flex items-center justify-center gap-3">
                <button onClick={runMatching} disabled={generating}
                  className="px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-full hover:opacity-90 disabled:opacity-50 transition shadow-lg">
                  {generating ? '匹配中...' : '🎁 开始匹配'}
                </button>
                {/* 始终可见的历史记录入口 */}
                {!matchDetailVerified ? (
                  <button onClick={requestMatchDetail}
                    className="px-5 py-3 text-sm font-medium text-purple-600 border border-purple-200 rounded-full hover:bg-purple-50 transition">
                    📜 查看历史配对记录
                  </button>
                ) : (
                  <button onClick={() => setMatchDetailVerified(false)}
                    className="px-5 py-3 text-sm font-medium text-pink-500 border border-pink-200 rounded-full hover:bg-pink-50 transition">
                    🙈 隐藏历史记录
                  </button>
                )}
              </div>
              {matchResult && !matchResult.error && (
                <button onClick={handleResetMatch} disabled={resettingMatch}
                  className="mt-3 px-6 py-2 text-sm font-medium text-red-500 border border-red-200 rounded-full hover:bg-red-50 transition disabled:opacity-50">
                  {resettingMatch ? '重置中...' : '🔄 重置本周匹配（删除结果+释放锁）'}
                </button>
              )}

            {/* ── 匹配结果摘要（仅本周有匹配结果时显示）── */}
            {matchResult && (
              <div className="mt-6 bg-gray-50 rounded-2xl p-6 text-left">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-800">匹配结果</h3>
                </div>
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

            {/* ── 历史配对记录详情列表（需二级密码验证 + 分页 + 周选择）── 独立于 matchResult ── */}
            {matchDetailVerified && (
              <div className="mt-6 bg-gray-50 rounded-2xl p-6 text-left">
                    {/* 周选择器 */}
                    <div className="flex items-center gap-3 mb-4">
                      <label className="text-xs font-medium text-gray-500 whitespace-nowrap">📅 查看周期：</label>
                      <select
                        value={adminSelectedWeek}
                        onChange={async (e) => {
                          const w = e.target.value
                          setAdminSelectedWeek(w)
                          setMatchPage(1)
                          await loadMatchDetails(1, w)
                        }}
                        className="px-3 py-1.5 bg-white/60 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-300"
                      >
                        <option value="">当前周（默认）</option>
                        {availableWeeks.map(w => (
                          <option key={w} value={w}>{w}{w === (matchResult?.weekKey || '') ? ' ✨' : ''}</option>
                        ))}
                      </select>
                      {adminSelectedWeek && (
                        <span className="text-xs text-purple-500 font-medium">{adminSelectedWeek} 的配对记录</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold text-sm text-gray-700">
                        💕 配对详情（共 {matchTotalPairs} 对{adminSelectedWeek ? ` · ${adminSelectedWeek}` : ''}）
                      </h4>
                      <span className="text-xs text-gray-400">
                        第 {matchPage}/{matchTotalPages || 1} 页
                      </span>
                    </div>

                    {loadingMatchDetails ? (
                      <p className="text-center text-gray-400 py-8">加载匹配详情...</p>
                    ) : matchPairs.length === 0 ? (
                      <p className="text-center text-gray-400 py-8">暂无匹配记录</p>
                    ) : (
                      <>
                        {/* 配对卡片列表 */}
                        <div className="space-y-3">
                          {matchPairs.map((pair: any) => (
                            <div key={pair.id} className="bg-white rounded-xl p-4 border border-pink-100 shadow-sm">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  {/* 用户A */}
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-cyan-300 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                      {(pair.userA?.name || '?')[0]}
                                    </span>
                                    <div className="min-w-0">
                                      <span className="text-sm font-medium text-gray-800 truncate block max-w-[120px]">
                                        {pair.userA?.name || '-'}
                                      </span>
                                      <span className="text-xs text-gray-400">{GENDER_LABELS[pair.userA?.gender] || '-'}</span>
                                    </div>
                                  </div>

                                  {/* 契合度 */}
                                  <div className="flex-shrink-0 px-3 py-1 bg-pink-50 rounded-full">
                                    <span className="text-sm font-bold text-pink-600">{pair.score}%</span>
                                  </div>

                                  {/* 用户B */}
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="min-w-0 text-right">
                                      <span className="text-sm font-medium text-gray-800 truncate block max-w-[120px]">
                                        {pair.userB?.name || '-'}
                                      </span>
                                      <span className="text-xs text-gray-400">{GENDER_LABELS[pair.userB?.gender] || '-'}</span>
                                    </div>
                                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-400 to-purple-300 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                      {(pair.userB?.name || '?')[0]}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              {/* 确认状态 */}
                              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50">
                                <span className={`text-xs ${pair.aRevealed ? 'text-green-500' : 'text-gray-400'}`}>
                                  {pair.userA?.name}: {pair.aRevealed ? '✅ 已确认' : '⏳ 待确认'}
                                </span>
                                <span className="text-gray-200">|</span>
                                <span className={`text-xs ${pair.bRevealed ? 'text-green-500' : 'text-gray-400'}`}>
                                  {pair.userB?.name}: {pair.bRevealed ? '✅ 已确认' : '⏳ 待确认'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* 未匹配用户（仅第一页显示） */}
                        {matchPage === 1 && matchUnmatched.length > 0 && (
                          <div className="mt-5 pt-4 border-t border-gray-200">
                            <h5 className="text-xs font-semibold text-gray-500 mb-2">😢 未匹配 ({matchUnmatched.length} 人)</h5>
                            <div className="flex flex-wrap gap-2">
                              {matchUnmatched.map((u: any) => (
                                <span key={u.id} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                                  {u.name} ({GENDER_LABELS[u.gender]})
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 分页导航 */}
                        {matchTotalPages > 1 && (
                          <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-gray-100">
                            <button
                              onClick={() => { setMatchPage(p => Math.max(1, p - 1)); loadMatchDetails(Math.max(1, matchPage - 1), adminSelectedWeek) }}
                              disabled={matchPage <= 1}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed bg-white border border-gray-200 text-gray-600 hover:bg-pink-50 hover:border-pink-200 hover:text-pink-600">
                              ← 上一页
                            </button>
                            {Array.from({ length: matchTotalPages }, (_, i) => i + 1)
                              .filter(p => {
                                if (p === 1 || p === matchTotalPages) return true
                                if (p >= matchPage - 1 && p <= matchPage + 1) return true
                                return false
                              })
                              .map((p, idx, arr) => (
                                <Fragment key={p}>
                                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                                    <span className="w-8 h-7 flex items-center justify-center text-xs text-gray-400">…</span>
                                  )}
                                  <button
                                    onClick={() => { setMatchPage(p); loadMatchDetails(p, adminSelectedWeek) }}
                                    className={`w-8 h-7 text-xs font-medium rounded-lg transition ${
                                      p === matchPage
                                        ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow'
                                        : 'bg-white border border-gray-200 text-gray-600 hover:bg-pink-50 hover:border-pink-200'
                                    }`}>
                                    {p}
                                  </button>
                                </Fragment>
                              ))}
                            <button
                              onClick={() => { setMatchPage(p => Math.min(matchTotalPages, p + 1)); loadMatchDetails(Math.min(matchTotalPages, matchPage + 1), adminSelectedWeek) }}
                              disabled={matchPage >= matchTotalPages}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed bg-white border border-gray-200 text-gray-600 hover:bg-pink-50 hover:border-pink-200 hover:text-pink-600">
                              下一页 →
                            </button>
                          </div>
                        )}
                      </>
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
                    开启后，注册时必须在长春高校圈附近（{gpsRequired ? '当前已开启' : '当前已关闭'}）
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

              {/* 邀请码功能开关 */}
              <div className="flex items-center justify-between py-4 border-b border-gray-100">
                <div>
                  <p className="font-medium text-gray-800">📨 邀请码注册</p>
                  <p className="text-sm text-gray-400 mt-1">
                    开启后，新用户必须使用邀请码才能注册（{inviteRequired ? '当前已开启' : '当前已关闭'}）
                  </p>
                </div>
                <button
                  onClick={toggleInviteRequired}
                  disabled={savingSettings}
                  className={`w-14 h-8 rounded-full transition-colors ${inviteRequired ? 'bg-pink-500' : 'bg-gray-300'}`}
                >
                  <div
                    className={`w-6 h-6 bg-white rounded-full shadow transition-transform ${
                      inviteRequired ? 'translate-x-7' : 'translate-x-1'
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

            {/* 修改管理员密码 */}
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

            {/* 设置查看详情二级密码（独立于登录密码） */}
            <div className="glass-card rounded-2xl p-6 mt-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2">🔑 查看详情二级密码</h3>
              <p className="text-sm text-gray-400 mb-4">
                独立于管理员登录密码，用于查看用户敏感信息（联系方式、问卷等）前的二次验证。
                即使登录 session 被劫持，没有此密码也无法查看用户详情。
              </p>
              {hasViewPassword === null ? (
                <p className="text-xs text-gray-300">加载中...</p>
              ) : (
                <div className="space-y-3 max-w-md">
                  {hasViewPassword && (
                    <input
                      type="password"
                      placeholder="当前密码"
                      value={viewPwCurrent}
                      onChange={e => setViewPwCurrent(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      disabled={settingViewPw} />
                  )}
                  <input
                    type="password"
                    placeholder={hasViewPassword ? '新的查看详情密码' : '设置查看详情密码（至少8位，含字母和数字）'}
                    value={viewPwInput}
                    onChange={e => setViewPwInput(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    disabled={settingViewPw} />
                  {hasViewPassword && (
                    <input
                      type="password"
                      placeholder="确认新密码"
                      value={viewPwConfirm}
                      onChange={e => setViewPwConfirm(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSetViewPassword() }}
                      className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      disabled={settingViewPw} />
                  )}
                  <button onClick={handleSetViewPassword}
                    disabled={settingViewPw || !viewPwInput || (hasViewPassword && (!viewPwCurrent || !viewPwConfirm))}
                    className={`px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl hover:opacity-90 disabled:opacity-50 transition`}>
                    {settingViewPw ? '保存中...' : (hasViewPassword ? '更新二级密码' : '设置二级密码')}
                  </button>
                  {hasViewPassword && (
                    <p className="text-xs text-green-600">✅ 已设置</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 二级密码验证弹窗（用户详情） */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowPasswordModal(false)}>
          <div className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-2">🔐 安全验证</h3>
            <p className="text-sm text-gray-400 mb-5">查看用户详情需要输入独立的查看详情密码</p>
            <input
              type="password"
              value={verifyPassword}
              onChange={e => { setVerifyPassword(e.target.value); setVerifyError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleVerifyPassword() }}
              placeholder="请输入查看详情密码"
              autoFocus
              className={`w-full px-4 py-3 bg-white/60 border rounded-xl text-sm focus:outline-none focus:ring-2 transition ${
                verifyError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-pink-300'
              }`}
              disabled={verifyingPw}
            />
            {verifyError && <p className="text-xs text-red-500 mt-1.5">{verifyError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowPasswordModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                取消
              </button>
              <button onClick={handleVerifyPassword} disabled={verifyingPw || !verifyPassword.trim()}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl hover:opacity-90 transition ${
                  verifyingPw || !verifyPassword.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {verifyingPw ? '验证中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 二级密码验证弹窗（匹配详情） */}
      {showMatchPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowMatchPwModal(false)}>
          <div className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-2">🔐 查看匹配详情</h3>
            <p className="text-sm text-gray-400 mb-5">查看匹配详情需要输入独立的查看详情二级密码</p>
            <input
              type="password"
              value={matchVerifyPassword}
              onChange={e => { setMatchVerifyPassword(e.target.value); setMatchVerifyError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleMatchVerifyPassword() }}
              placeholder="请输入查看详情密码"
              autoFocus
              className={`w-full px-4 py-3 bg-white/60 border rounded-xl text-sm focus:outline-none focus:ring-2 transition ${
                matchVerifyError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-purple-300'
              }`}
              disabled={matchVerifyingPw}
            />
            {matchVerifyError && <p className="text-xs text-red-500 mt-1.5">{matchVerifyError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowMatchPwModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                取消
              </button>
              <button onClick={handleMatchVerifyPassword} disabled={matchVerifyingPw || !matchVerifyPassword.trim()}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl hover:opacity-90 transition ${
                  matchVerifyingPw || !matchVerifyPassword.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {matchVerifyingPw ? '验证中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除用户二级密码确认弹窗 */}
      {deletePwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDeletePwModal(false)}>
          <div className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-red-600 mb-2">⚠️ 危险操作</h3>
            <p className="text-sm text-gray-400 mb-5">删除用户需要管理员二次确认，请输入管理员密码以继续</p>
            <input
              type="password"
              value={deletePw}
              onChange={e => { setDeletePw(e.target.value); setDeletePwError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmDelete() }}
              placeholder="请输入管理员密码"
              autoFocus
              className={`w-full px-4 py-3 bg-white/60 border rounded-xl text-sm focus:outline-none focus:ring-2 transition ${
                deletePwError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-pink-300'
              }`}
              disabled={deletingConfirmed}
            />
            {deletePwError && <p className="text-xs text-red-500 mt-1.5">{deletePwError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setDeletePwModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                取消
              </button>
              <button onClick={handleConfirmDelete} disabled={deletingConfirmed || !deletePw.trim()}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-orange-500 rounded-xl hover:opacity-90 transition ${
                  deletingConfirmed || !deletePw.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {deletingConfirmed ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
