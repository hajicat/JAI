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

const GENDER_LABELS: Record<string, string> = { male: '男', female: '女', other: '其他', all: '不限' }
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
  const [tab, setTab] = useState<'users' | 'codes' | 'match' | 'recommend' | 'settings' | 'gps-feedback' | 'broadcast'>('users')
  const [users, setUsers] = useState<any[]>([])
  const [codes, setCodes] = useState<any[]>([])
  const [matchResult, setMatchResult] = useState<any>(null)
  const [gpsFeedbacks, setGpsFeedbacks] = useState<any[]>([])
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
  const [deletingMatchId, setDeletingMatchId] = useState<number | null>(null)
  const [matchUsersForSelect, setMatchUsersForSelect] = useState<any[]>([])

  // 手动匹配预览（选两个用户后实时显示匹配度，不写库）
  const [manualPreview, setManualPreview] = useState<{
    score: number; dimScores: any[]; reasons: string[]; safetyLevel: string
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // 推荐匹配状态
  const [recUserId, setRecUserId] = useState<number | ''>('')
  const [recLoading, setRecLoading] = useState(false)
  const [recResults, setRecResults] = useState<any>(null)  // { selectedUser, totalCandidates, compatibleCount, recommendations[] }
  const [recManualTarget, setRecManualTarget] = useState<number | null>(null)  // 点击推荐结果后填入手动配对的目标用户

  // 匹配配置状态（后台可调参数）
  const [matchConfig, setMatchConfig] = useState<{
    threshold: number
    softThreshold: number
    probabilityMode: boolean
    baseProbability: number
  } | null>(null)
  const [matchConfigSaving, setMatchConfigSaving] = useState(false)

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

  // 自动匹配触发状态（用户端触发的记录）
  const [autoTriggerInfo, setAutoTriggerInfo] = useState<any>(null)
  // 匹配通知邮件状态
  const [notifySending, setNotifySending] = useState(false)
  const [notifyLockStatus, setNotifyLockStatus] = useState<string | null>(null)
  const [notifySentCount, setNotifySentCount] = useState<number>(0)
  const [notifyResult, setNotifyResult] = useState<{ error?: string; sent?: number; failed?: number } | null>(null)
  // 历史周选择（用于查看非当前周的配对记录）
  const [adminSelectedWeek, setAdminSelectedWeek] = useState<string>('')
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([])

  // 群发邮件状态
  const [broadcastSubject, setBroadcastSubject] = useState('')
  const [broadcastContent, setBroadcastContent] = useState('')
  const [broadcastUserIds, setBroadcastUserIds] = useState<Set<number>>(new Set()) // 空集合=全选
  const [broadcastSelectAll, setBroadcastSelectAll] = useState(true) // 默认全选
  const [broadcastInterval, setBroadcastInterval] = useState(5) // 默认5秒间隔
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [broadcastResult, setBroadcastResult] = useState<{ total?: number; sent?: number; failed?: number; results?: any[]; error?: string } | null>(null)
  const [broadcastUsers, setBroadcastUsers] = useState<any[]>([])
  const [broadcastLoaded, setBroadcastLoaded] = useState(false)

  // 验证状态修改（无需二级密码）— 仅对无校园邮箱用户开放
  const [editVerifOpen, setEditVerifOpen] = useState(false)
  const [editVerifUserId, setEditVerifUserId] = useState<number | null>(null)
  const [editVerifNickname, setEditVerifNickname] = useState('')
  const [editVerifStatus, setEditVerifStatus] = useState('')
  const [editVerifScore, setEditVerifScore] = useState<number | ''>('')
  const [editVerifLoading, setEditVerifLoading] = useState(false)

  // 安全等级修改（无需二级密码）
  const [editSafetyOpen, setEditSafetyOpen] = useState(false)
  const [editSafetyUserId, setEditSafetyUserId] = useState<number | null>(null)
  const [editSafetyNickname, setEditSafetyNickname] = useState('')
  const [editSafetyLevel, setEditSafetyLevel] = useState('')
  const [editSafetyLoading, setEditSafetyLoading] = useState(false)

  // 修改学校状态
  const [editSchoolOpen, setEditSchoolOpen] = useState(false)
  const [editSchoolUserId, setEditSchoolUserId] = useState<number | null>(null)
  const [editSchoolNickname, setEditSchoolNickname] = useState('')
  const [editSchoolValue, setEditSchoolValue] = useState('')
  const [editSchoolLoading, setEditSchoolLoading] = useState(false)

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
    if (tab === 'match') { loadMatchUsers(); loadMatchConfig() }
    if (tab === 'gps-feedback') loadGpsFeedbacks()
    if (tab === 'broadcast' && !broadcastLoaded) loadBroadcastUsers()
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
      if (!res.ok) {
        setToast({ msg: '加载用户详情失败，请重试', type: 'error' })
        setLoadingDetail(false)
        return
      }
      const data = await res.json()
      setUserDetail(data)
    } catch {
      setToast({ msg: '网络错误，请重试', type: 'error' })
    } finally { setLoadingDetail(false) }
  }

  // 删除用户密码确认状态
  const [deletePwModal, setDeletePwModal] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [deletePw, setDeletePw] = useState('')
  const [deletePwError, setDeletePwError] = useState('')
  const [deletingConfirmed, setDeletingConfirmed] = useState(false)

  // 重置用户密码弹窗状态
  const [resetPwModal, setResetPwModal] = useState(false)
  const [resetPwUserId, setResetPwUserId] = useState<number | null>(null)
  const [resetPwNickname, setResetPwNickname] = useState('')
  const [resetPwNew, setResetPwNew] = useState('')
  const [resetPwConfirm, setResetPwConfirm] = useState('')
  const [resetPwError, setResetPwError] = useState('')
  const [resettingPw, setResettingPw] = useState(false)

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

  /** 打开重置密码弹窗 */
  const handleOpenResetPw = (uid: number, nickname: string) => {
    setResetPwUserId(uid)
    setResetPwNickname(nickname)
    setResetPwNew('')
    setResetPwConfirm('')
    setResetPwError('')
    setResetPwModal(true)
  }

  /** 发送/重发匹配通知邮件 */
  const handleSendNotify = async (force: boolean = false) => {
    setNotifySending(true)
    setNotifyResult(null)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ force }),
      })
      const data = await res.json()
      if (!res.ok || (data.status && data.status !== 'done' && !data.sent)) {
        setNotifyResult({ error: data.error || data.message || '发送失败' })
      } else {
        setNotifyResult({ sent: data.sent, failed: data.failed })
        // 刷新状态（静默调用，不阻塞）
        fetch('/api/admin/match-status').then(r => r.json()).catch(() => {})
      }
    } catch (e) {
      setNotifyResult({ error: '网络错误，请重试' })
    }
    setNotifySending(false)
  }

  // ── 群发邮件相关函数 ──

  /** 加载用户列表（用于群发选择） */
  const loadBroadcastUsers = async () => {
    try {
      const res = await fetch('/api/admin/users?all=1')
      const data = await res.json()
      setBroadcastUsers(data.users || [])
      setBroadcastLoaded(true)
      // 默认全选（userIds 为空表示全选）
      setBroadcastUserIds(new Set())
      setBroadcastSelectAll(true)
    } catch {
      setToast({ msg: '加载用户列表失败', type: 'error' })
    }
  }

  /** 执行群发邮件 */
  const handleBroadcastSend = async () => {
    if (!broadcastSubject.trim() || !broadcastContent.trim()) return
    if (broadcastSending) return

    const confirmMsg = broadcastSelectAll
      ? `⚠️ 确定向全部 ${broadcastUsers.length} 位用户发送邮件？\n\n标题：${broadcastSubject}\n间隔：${broadcastInterval}秒`
      : `⚠️ 确定向 ${broadcastUsers.length - broadcastUserIds.size} 位用户发送邮件？\n\n标题：${broadcastSubject}\n间隔：${broadcastInterval}秒`

    if (!confirm(confirmMsg)) return

    setBroadcastSending(true)
    setBroadcastResult(null)

    try {
      const csrfToken = getCsrfToken()
      const body: any = {
        subject: broadcastSubject,
        htmlContent: broadcastContent,
        intervalMs: broadcastInterval * 1000,
      }
      // 非全选时传入排除的用户ID
      if (!broadcastSelectAll && broadcastUserIds.size > 0) {
        body.userIds = broadcastUsers
          .filter((u: any) => !broadcastUserIds.has(u.id))
          .map((u: any) => u.id)
      }
      // 全选时不传 userIds，后端会自动查全部用户

      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        setBroadcastResult({ error: data.error || '发送失败' })
      } else {
        setBroadcastResult(data)
      }
    } catch (e) {
      setBroadcastResult({ error: '网络错误，请检查连接' })
    } finally {
      setBroadcastSending(false)
    }
  }

  /** 提交重置密码 */
  const handleResetPassword = async () => {
    if (!resetPwNew.trim()) { setResetPwError('请输入新密码'); return }
    if (resetPwNew.length < 8) { setResetPwError('密码至少8位'); return }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(resetPwNew)) { setResetPwError('密码需同时包含字母和数字'); return }
    if (resetPwNew !== resetPwConfirm) { setResetPwError('两次输入的密码不一致'); return }
    if (resetPwUserId == null) return

    setResettingPw(true)
    setResetPwError('')
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/reset-user-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({
          userId: resetPwUserId,
          newPassword: resetPwNew,
          adminPassword: resetPwConfirm,
        }),
      })
      if (!res.ok) {
        setResetPwError('请求失败，请重试')
        setResettingPw(false)
        return
      }
      const data = await res.json()
      if (data.success) {
        setResetPwModal(false)
        setToast({ msg: `✅ ${data.message}`, type: 'success' })
      } else {
        setResetPwError(data.error || '重置失败')
      }
    } catch {
      setResetPwError('网络错误，请重试')
    } finally {
      setResettingPw(false)
    }
  }

  /** 打开验证状态修改弹窗 */
  const openEditVerif = (uid: number, nickname: string, status: string | null, score: number | null) => {
    setEditVerifUserId(uid)
    setEditVerifNickname(nickname)
    setEditVerifStatus(status || 'null')
    setEditVerifScore(score ?? '')
    setEditVerifOpen(true)
  }

  /** 提交验证状态修改 */
  const handleSaveVerif = async () => {
    if (editVerifUserId === null) return
    setEditVerifLoading(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch(`/api/admin/users?id=${editVerifUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({
          verificationStatus: editVerifStatus,
          verificationScore: editVerifScore !== '' ? Number(editVerifScore) : null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setEditVerifOpen(false)
        setToast({ msg: `✅ ${data.message}`, type: 'success' })
        loadUsers(currentPage)
        if (expandedUserId === editVerifUserId) loadUserDetail(editVerifUserId)
      } else {
        setToast({ msg: `❌ ${data.error || '修改失败'}`, type: 'error' })
      }
    } catch {
      setToast({ msg: '❌ 网络错误', type: 'error' })
    } finally {
      setEditVerifLoading(false)
    }
  }

  /** 打开安全等级修改弹窗 */
  const openEditSafety = (uid: number, nickname: string, currentLevel: string | null) => {
    setEditSafetyUserId(uid)
    setEditSafetyNickname(nickname)
    setEditSafetyLevel(currentLevel || 'null')
    setEditSafetyOpen(true)
  }

  /** 打开学校修改弹窗 */
  const openEditSchool = (uid: number, nickname: string, currentSchool: string | null) => {
    setEditSchoolUserId(uid)
    setEditSchoolNickname(nickname)
    setEditSchoolValue(currentSchool || 'null')
    setEditSchoolOpen(true)
  }

  /** 提交学校修改 */
  const handleSaveSchool = async () => {
    if (editSchoolUserId === null) return
    setEditSchoolLoading(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch(`/api/admin/users?id=${editSchoolUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ school: editSchoolValue }),
      })
      const data = await res.json()
      if (data.success) {
        setEditSchoolOpen(false)
        setToast({ msg: `✅ ${data.message}`, type: 'success' })
        loadUsers(currentPage)
        if (expandedUserId === editSchoolUserId) loadUserDetail(editSchoolUserId)
      } else {
        setToast({ msg: `❌ ${data.error || '修改失败'}`, type: 'error' })
      }
    } catch {
      setToast({ msg: '❌ 网络错误', type: 'error' })
    } finally {
      setEditSchoolLoading(false)
    }
  }

  /** 提交安全等级修改 */
  const handleSaveSafety = async () => {
    if (editSafetyUserId === null) return
    setEditSafetyLoading(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch(`/api/admin/users?id=${editSafetyUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ safetyLevel: editSafetyLevel }),
      })
      const data = await res.json()
      if (data.success) {
        setEditSafetyOpen(false)
        setToast({ msg: `✅ ${data.message}`, type: 'success' })
        loadUsers(currentPage)
        if (expandedUserId === editSafetyUserId) loadUserDetail(editSafetyUserId)
      } else {
        setToast({ msg: `❌ ${data.error || '修改失败'}`, type: 'error' })
      }
    } catch {
      setToast({ msg: '❌ 网络错误', type: 'error' })
    } finally {
      setEditSafetyLoading(false)
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

  const loadGpsFeedbacks = async () => {
    try {
      const res = await fetch('/api/gps-feedback')
      const data = await res.json()
      setGpsFeedbacks(data.feedbacks || [])
    } catch {
      setGpsFeedbacks([])
    }
  }

  const deleteGpsFeedback = async (id: number) => {
    try {
      await fetch('/api/gps-feedback', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
        body: JSON.stringify({ id }),
      })
      setGpsFeedbacks(prev => prev.filter((f: any) => f.id !== id))
    } catch {
      // 静默
    }
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

  // 删除单条匹配记录（管理员清理测试数据用）
  const handleDeleteMatch = async (matchId: number, label?: string) => {
    if (!confirm(`确定删除此匹配记录？${label ? `\n${label}` : ''}\n\n⚠️ 此操作不可恢复！`)) return
    setDeletingMatchId(matchId)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/delete-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ matchId }),
      })
      const data = await res.json()
      if (data.success) {
        setToast({ msg: `✅ 已删除：${data.deleted.users}`, type: 'success' })
        setMatchResult(null)
        // 刷新匹配详情列表（如果正在显示）
        loadMatchDetails(matchPage, adminSelectedWeek)
      } else {
        setToast({ msg: data.error || '删除失败', type: 'error' })
      }
    } catch { setToast({ msg: '网络错误', type: 'error' }) }
    finally { setDeletingMatchId(null) }
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

  // 预览两个用户的匹配度（选满两个用户后自动触发，带防抖）
  useEffect(() => {
    if (!manualUserA || !manualUserB) {
      setManualPreview(null)
      return
    }
    const timer = setTimeout(async () => {
      setPreviewLoading(true)
      try {
        const csrfToken = getCsrfToken()
        const res = await fetch('/api/admin/match-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({ userA: manualUserA, userB: manualUserB }),
        })
        const data = await res.json()
        if (data.success && data.preview) {
          setManualPreview(data.preview)
        } else {
          setManualPreview(null)
        }
      } catch {
        setManualPreview(null)
      } finally {
        setPreviewLoading(false)
      }
    }, 400) // 400ms 防抖
    return () => clearTimeout(timer)
  }, [manualUserA, manualUserB])

  // ── 匹配配置（后台可调参数）──
  const loadMatchConfig = async () => {
    try {
      const res = await fetch('/api/admin/match-config')
      const data = await res.json()
      if (data.config) setMatchConfig(data.config)
    } catch { /* ignore */ }
  }

  const handleSaveMatchConfig = async () => {
    if (!matchConfig) return
    setMatchConfigSaving(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/admin/match-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(matchConfig),
      })
      const data = await res.json()
      if (!res.ok) {
        setToast({ msg: data.error || '保存失败', type: 'error' })
      } else {
        setToast({ msg: '✅ 匹配配置已保存，下次匹配生效', type: 'success' })
      }
    } catch {
      setToast({ msg: '网络错误', type: 'error' })
    } finally {
      setMatchConfigSaving(false)
    }
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
        // 记录用户端自动触发信息（管理员可查看是否真的被触发了）
        if (data.autoTrigger) setAutoTriggerInfo(data.autoTrigger)
        else setAutoTriggerInfo(null)
        // 记录通知邮件状态
        setNotifyLockStatus(data.notifyLockStatus || null)
        setNotifySentCount(data.notifySentCount || 0)
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 via-white to-stone-50">
        <div className="text-5xl animate-bounce">🎁</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-modal-in ${
          toast.type === 'success' ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-red-50 text-red-500 border border-red-200'
        }`}>
          {toast.msg}
        </div>
      )}
      <nav className="flex items-center justify-between px-4 py-3 max-w-5xl mx-auto gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <img src="/logo.png" alt="吉我爱" className="w-7 h-7 shrink-0" />
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
            { key: 'recommend', label: '💡 推荐匹配', count: null },
            { key: 'gps-feedback', label: '📍 定位反馈', count: gpsFeedbacks.length || null },
            { key: 'broadcast', label: '📧 群发邮件', count: null },
            { key: 'settings', label: '⚙️ 系统设置', count: null },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition ${
                tab === t.key ? 'bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] text-[#8b4a54] shadow-lg' : 'bg-white/60 text-gray-500 hover:bg-white'
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
                              {/* 操作按钮 */}
                              <div className="flex justify-end gap-2 mb-3">
                                <button
                                  onClick={() => handleOpenResetPw(u.id, String(u.nickname))}
                                  className="text-xs font-medium px-4 py-2 rounded-lg border transition
                                    text-stone-600 border-stone-300 hover:bg-stone-100 hover:border-stone-400"
                                >
                                  🔑 重置密码
                                </button>
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
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-400">所属学校：</span>
                                        <span>{userDetail.user.school || '-'}</span>
                                        <button
                                          onClick={() => openEditSchool(u.id, u.nickname, userDetail.user.school)}
                                          className="text-xs text-blue-500 hover:underline"
                                        >
                                          修改
                                        </button>
                                      </div>
                                      <div className="break-words"><span className="text-gray-400">匹配学校偏好：</span>{
                                        Array.isArray(userDetail.user.matchSchoolPrefs) && userDetail.user.matchSchoolPrefs.length > 0
                                          ? userDetail.user.matchSchoolPrefs.join('、')
                                          : '—'
                                      }</div>
                                      <div><span className="text-gray-400">注册时间：</span>{formatBeijingTime(userDetail.user.createdAt)}</div>
                                      {/* 安全等级 */}
                                      <div className="col-span-2 flex items-center gap-2">
                                        <span className="text-gray-400">安全等级：</span>
                                        <span className={`font-medium ${SAFETY_LABELS[userDetail.user.safetyLevel || 'normal']?.color || 'text-gray-400'}`}>
                                          {SAFETY_LABELS[userDetail.user.safetyLevel || 'normal']?.label || '—'}
                                        </span>
                                        {userDetail.user.hasManualSafetyLevel && (
                                          <span className="text-xs text-gray-400">（管理员设置）</span>
                                        )}
                                        <button
                                          onClick={() => openEditSafety(
                                            u.id,
                                            u.nickname,
                                            userDetail.user.safetyLevel,
                                          )}
                                          className="ml-1 text-xs text-blue-500 hover:underline"
                                        >
                                          修改
                                        </button>
                                      </div>
                                      {/* 学生验证状态 — 仅对无校园邮箱用户显示 */}
                                      {userDetail.user.needsStudentVerif && (
                                        <div className="col-span-2">
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
                                          <button
                                            onClick={() => openEditVerif(
                                              u.id,
                                              u.nickname,
                                              userDetail.user.verificationStatus,
                                              userDetail.user.verificationScore,
                                            )}
                                            className="ml-2 text-xs text-blue-500 hover:underline"
                                          >
                                            修改
                                          </button>
                                        </div>
                                      )}
                                      {!userDetail.user.needsStudentVerif && (
                                        <div className="col-span-2 text-xs text-gray-400">学生验证：— （校园邮箱注册，无需GPS验证）</div>
                                      )}
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
                              ? 'bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] text-[#8b4a54] shadow'
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
                className="px-5 py-2 text-sm font-medium bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-xl hover:opacity-90 transition text-[#8b4a54]">
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
            {/* ═══ 自动匹配触发状态（用户端触发的记录）═══ */}
            <div className={`rounded-2xl p-5 border ${
              autoTriggerInfo
                ? 'bg-green-50/60 border-green-200'
                : 'bg-stone-50 border-stone-200'
            }`}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-lg">{autoTriggerInfo ? '✅' : '⏳'}</span>
                <h3 className="font-semibold text-gray-800 text-sm">自动匹配触发状态</h3>
              </div>
              {autoTriggerInfo ? (
                <div className="text-sm space-y-1">
                  <p className="text-gray-600">
                    <span className="font-medium text-green-700">已触发</span>
                    {' · 触发时间：'}
                    <span className="font-mono">{autoTriggerInfo.triggeredAtFormatted}</span>
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-500">
                    <span>👥 参与 {autoTriggerInfo.totalEligible} 人</span>
                    <span>💌 配对 {autoTriggerInfo.matchedPairs} 对</span>
                    <span>😢 未匹配 {autoTriggerInfo.unmatchedUsers} 人</span>
                    {autoTriggerInfo.status === 'already_done' && (
                      <span className="text-yellow-600">⚠️ 重复触发（已有结果）</span>
                    )}
                    {autoTriggerInfo.inferred && (
                      <span className="text-blue-600" title="匹配在触发记录功能上线前执行，数据从匹配结果表补算">
                        📋 数据补算（上线前已执行）
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  尚未有用户端自动触发记录。自动匹配将在北京时间周日 12:00 后，由首个访问 /match 页面的已完成问卷用户触发。
                  你也可以直接点击下方「开始匹配」按钮手动执行。
                </p>
              )}
            </div>

            {/* ═══ 匹配通知邮件状态 ═══ */}
            {notifyLockStatus && (
              <div className={`rounded-2xl p-5 border ${
                notifyLockStatus === 'done'
                  ? 'bg-blue-50/60 border-blue-200'
                  : notifyLockStatus === 'running'
                    ? 'bg-yellow-50/60 border-yellow-200'
                    : 'bg-stone-50 border-stone-200'
              }`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg">📧</span>
                  <h3 className="font-semibold text-gray-800 text-sm">匹配通知邮件</h3>
                </div>
                <div className="text-sm space-y-1">
                  <p className="text-gray-600">
                    状态：
                    <span className={`font-medium ${
                      notifyLockStatus === 'done' ? 'text-blue-700' :
                      notifyLockStatus === 'running' ? 'text-yellow-700' : 'text-gray-500'
                    }`}>
                      {notifyLockStatus === 'done' ? '✅ 已发送' :
                       notifyLockStatus === 'running' ? '⏳ 发送中...' : '❌ 未触发'}
                    </span>
                    {notifySentCount > 0 && `（已发 ${notifySentCount} 封）`}
                  </p>
                </div>

                {/* 手动发送/重发按钮 */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    onClick={() => handleSendNotify()}
                    disabled={notifySending}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${
                      notifySending
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 active:scale-95'
                    }`}>
                    {notifySending ? '发送中...' : notifyLockStatus === 'done' ? '🔄 重新发送' : '📤 发送通知'}
                  </button>
                  {notifyLockStatus === 'done' && (
                    <button
                      onClick={() => {
                        if (confirm('强制重发会清除所有已发送记录，给所有匹配用户重新发一封邮件。确定吗？')) handleSendNotify(true)
                      }}
                      disabled={notifySending}
                      className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${
                        notifySending
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 active:scale-95'
                      }`}>
                      ⚡ 强制重发全部
                    </button>
                  )}
                  {notifyResult && (
                    <span className={`text-xs ${notifyResult.error ? 'text-red-500' : 'text-green-600'}`}>
                      {notifyResult.error || `已发送 ${notifyResult.sent ?? 0} 封${(notifyResult.failed ?? 0) > 0 ? `，失败 ${notifyResult.failed} 封` : ''}`}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════ ⚙️ 匹配算法配置（后台可调）════════════ */}
            {matchConfig && (
              <div className="glass-card rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <span className="text-lg">⚙️</span>
                  <h3 className="text-base font-bold text-gray-800">匹配算法配置</h3>
                  <span className="text-xs text-gray-400">修改后下次匹配生效</span>
                </div>

                {/* 阈值设置 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">
                      硬门槛（分） — 超过此分数<strong>一定配对</strong>
                    </label>
                    <input
                      type="number" min={0} max={99}
                      value={matchConfig.threshold}
                      onChange={e => setMatchConfig({ ...matchConfig, threshold: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-pink-300 outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">默认 76，降低可增加配对数量</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">
                      软门槛（分） — 仅在概率模式生效时使用
                    </label>
                    <input
                      type="number" min={0} max={99}
                      value={matchConfig.softThreshold}
                      onChange={e => setMatchConfig({ ...matchConfig, softThreshold: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}
                      className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-pink-300 outline-none ${
                        matchConfig.softThreshold > matchConfig.threshold ? 'border-red-300 bg-red-50' : 'border-gray-200'
                      }`}
                    />
                    {matchConfig.softThreshold > matchConfig.threshold && (
                      <p className="text-xs text-red-500 mt-1">⚠️ 不能大于硬门槛</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">默认 50，此分数以上有概率配对</p>
                  </div>
                </div>

                {/* 概率模式开关 + 基础概率 */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none bg-white/60 border border-gray-200 rounded-xl px-4 py-3 hover:bg-white transition flex-1">
                    <input
                      type="checkbox"
                      checked={matchConfig.probabilityMode}
                      onChange={e => setMatchConfig({ ...matchConfig, probabilityMode: e.target.checked })}
                      className="w-4 h-4 accent-pink-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">🎲 概率匹配模式</span>
                      <p className="text-xs text-gray-400">开启后，软~硬门槛之间的分数按概率配对</p>
                    </div>
                  </label>

                  {matchConfig.probabilityMode && (
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">基础命中率（%）</label>
                      <input
                        type="number" min={0} max={100}
                        value={matchConfig.baseProbability}
                        onChange={e => setMatchConfig({ ...matchConfig, baseProbability: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-pink-300 outline-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        分数越高概率越大：{matchConfig.softThreshold}分≈{matchConfig.baseProbability}%，{matchConfig.threshold}分=100%
                      </p>
                    </div>
                  )}
                </div>

                {/* 预估效果提示 */}
                <div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-4 text-xs text-gray-600 space-y-1">
                  <p><strong>当前效果预估：</strong></p>
                  <ul className="list-disc list-inside space-y-0.5 text-gray-500 ml-1">
                    <li>分数 ≥ <strong>{matchConfig.threshold}</strong> → ✅ 一定配对</li>
                    {matchConfig.probabilityMode ? (
                      <>
                        <li>分数 {matchConfig.softThreshold} ~ {matchConfig.threshold} → 🎲 按概率配对（约 {matchConfig.baseProbability}% ~ 100%）</li>
                        <li>分数 &lt; {matchConfig.softThreshold} → ❌ 不配对</li>
                      </>
                    ) : (
                      <li>分数 &lt; {matchConfig.threshold} → ❌ 不配对（概率模式未开启）</li>
                    )}
                  </ul>
                </div>

                {/* 保存按钮 */}
                <button
                  onClick={handleSaveMatchConfig}
                  disabled={matchConfigSaving || matchConfig.softThreshold > matchConfig.threshold}
                  className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition ${
                    matchConfigSaving || matchConfig.softThreshold > matchConfig.threshold
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#ec4899] to-[#a855f7] text-white hover:opacity-90 shadow-md'
                  }`}>
                  {matchConfigSaving ? '保存中...' : '💾 保存配置'}
                </button>
              </div>
            )}

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

              {/* 匹配度预览（选满两个用户后自动显示） */}
              {manualUserA && manualUserB && (
                <div className="mt-2 p-4 rounded-2xl border bg-gradient-to-r from-pink-50/80 to-stone-50/80 border-pink-100 animate-fade-in">
                  {previewLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="animate-spin inline-block w-4 h-4 border-2 border-pink-300 border-t-transparent rounded-full"></span>
                      计算匹配度中...
                    </div>
                  ) : manualPreview ? (
                    <div className="space-y-3">
                      {/* 总分 + 安全等级 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl font-bold gradient-text">{manualPreview.score}%</span>
                          <span className="text-sm text-gray-500">契合度</span>
                        </div>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                          manualPreview.safetyLevel === 'blocked' ? 'bg-red-50 text-red-600 border border-red-200' :
                          manualPreview.safetyLevel === 'restricted' ? 'bg-yellow-50 text-yellow-600 border border-yellow-200' :
                          'bg-green-50 text-green-600 border border-green-200'
                        }`}>
                          {manualPreview.safetyLevel === 'blocked' ? '🚫 安全筛查不通过' :
                           manualPreview.safetyLevel === 'restricted' ? '⚠️ 受限' : '✅ 安全'}
                        </span>
                      </div>
                      {/* 维度分条 */}
                      {manualPreview.dimScores && manualPreview.dimScores.length > 0 && (
                        <div className="space-y-2">
                          {manualPreview.dimScores.map((dim: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-16 text-right shrink-0">{dim.name}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    dim.score >= 70 ? 'bg-gradient-to-r from-green-400 to-emerald-300' :
                                    dim.score >= 50 ? 'bg-gradient-to-r from-yellow-300 to-amber-300' :
                                    'bg-gradient-to-r from-red-300 to-orange-300'
                                  }`}
                                  style={{ width: `${dim.score}%` }}
                                />
                              </div>
                              <span className={`text-xs font-bold w-8 text-right shrink-0 ${
                                dim.score >= 70 ? 'text-green-500' : dim.score >= 50 ? 'text-yellow-500' : 'text-red-400'
                              }`}>{dim.score}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* 匹配原因（最多显示2条） */}
                      {manualPreview.reasons && manualPreview.reasons.length > 0 && (
                        <div className="pt-2 border-t border-pink-100/60">
                          {manualPreview.reasons.slice(0, 2).map((r: string, i: number) => (
                            <p key={i} className="text-xs text-gray-500 leading-relaxed">• {r}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">无法计算匹配度（可能缺少问卷数据）</p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-4">
                <button onClick={runManualMatching}
                  disabled={manualMatching || !manualUserA || !manualUserB}
                  className={`px-6 py-2.5 text-sm font-semibold rounded-xl transition ${
                    manualMatching || !manualUserA || !manualUserB
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-stone-500 to-sky-400 text-white hover:opacity-90 shadow-md'
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
                  className="px-10 py-4 text-lg font-semibold bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-full hover:opacity-90 disabled:opacity-50 transition shadow-lg text-[#8b4a54]">
                  {generating ? '匹配中...' : '🎁 开始匹配'}
                </button>
                {/* 始终可见的历史记录入口 */}
                {!matchDetailVerified ? (
                  <button onClick={requestMatchDetail}
                    className="px-5 py-3 text-sm font-medium text-stone-700 border border-stone-200 rounded-full hover:bg-stone-50 transition">
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
                    {matchResult.match?.id && (
                      <button
                        onClick={() => handleDeleteMatch(matchResult.match.id, `${matchResult.match?.userAName} ↔ ${matchResult.match?.userBName}`)}
                        disabled={deletingMatchId === matchResult.match?.id}
                        className="mt-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        {deletingMatchId === matchResult.match?.id ? '删除中...' : '🗑️ 删除此条记录'}
                      </button>
                    )}
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
                        <span className="text-xs text-stone-500 font-medium">{adminSelectedWeek} 的配对记录</span>
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
                                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-400 to-stone-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
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
                                <button
                                  onClick={() => handleDeleteMatch(pair.id, `${pair.userA?.name} ↔ ${pair.userB?.name}`)}
                                  disabled={deletingMatchId === pair.id}
                                  className="ml-auto text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded transition disabled:opacity-50"
                                >
                                  {deletingMatchId === pair.id ? '删除中...' : '🗑️ 删除'}
                                </button>
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
                                        ? 'bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] text-[#8b4a54] shadow'
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

        {/* ═══════════ 💡 推荐匹配 Tab ═══════════ */}
        {tab === 'recommend' && (
          <div className="space-y-6">
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-base font-semibold text-gray-700 mb-1">💡 推荐匹配</h3>
              <p className="text-xs text-gray-400 mb-4">选择一个用户，系统按匹配算法列出最契合的候选人（符合该用户的性别偏好要求）</p>

              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="number"
                  value={recUserId}
                  onChange={e => setRecUserId(Number(e.target.value) || '')}
                  placeholder="输入用户 ID"
                  min={1}
                  className="w-40 px-4 py-2 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                />
                <button
                  onClick={() => { if (!recUserId) return; setRecLoading(true); setRecResults(null); setRecManualTarget(null)
                    const csrfToken = getCsrfToken()
                    fetch('/api/admin/match-recommendations', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                      body: JSON.stringify({ userId: recUserId, limit: 20 }),
                    }).then(r => r.json()).then(data => {
                      setRecLoading(false)
                      if (data.error) { alert('错误: ' + data.error); return }
                      setRecResults(data)
                    }).catch(() => { setRecLoading(false); alert('网络错误') })
                  }}
                  disabled={!recUserId || recLoading}
                  className="px-5 py-2 text-sm font-medium bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-xl hover:opacity-90 transition text-[#8b4a54] disabled:opacity-50"
                >
                  {recLoading ? '计算中...' : '🔍 查找最匹配的人'}
                </button>
                {recResults && (
                  <span className="text-xs text-gray-500">
                    共 {recResults.totalCandidates} 位候选人，
                    其中 {recResults.compatibleCount} 位符合性别偏好
                  </span>
                )}
              </div>
            </div>

            {/* 结果列表 */}
            {recLoading ? (
              <div className="glass-card rounded-2xl p-10 text-center animate-fade-in">
                <div className="text-3xl mb-3 animate-bounce">⏳</div>
                <p className="text-sm text-gray-400">正在计算匹配度...</p>
                <p className="text-xs text-gray-300 mt-1">需要逐一对比每位候选人的问卷答案，请稍候</p>
              </div>
            ) : recResults ? (
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-gray-700">推荐结果</span>
                    <span className="ml-2 text-xs text-pink-500">
                      为「{recResults.selectedUser.nickname}」({GENDER_LABELS[recResults.selectedUser.gender]} · {recResults.selectedUser.school || '未知学校'})
                      偏好: {GENDER_LABELS[recResults.selectedUser.preferredGender]}
                    </span>
                  </div>
                  {recResults.recommendations.length > 0 && (
                    <span className="text-xs text-green-600 font-medium">
                      Top {Math.min(recResults.recommendations.length, 20)} 位
                    </span>
                  )}
                </div>
                {recResults.recommendations.length === 0 ? (
                  <div className="p-10 text-center text-gray-400 text-sm">
                    😢 没有找到符合条件的候选人（可能该用户已与所有兼容用户配对过）
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {recResults.recommendations.map((r: any, i: number) => (
                      <div key={r.userId} className="flex items-center gap-4 px-5 py-4 hover:bg-pink-50/30 transition group">
                        {/* 排名 */}
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          i === 0 ? 'bg-yellow-100 text-yellow-700' :
                          i === 1 ? 'bg-stone-200 text-stone-600' :
                          i === 2 ? 'bg-orange-50 text-orange-500' :
                          'bg-gray-100 text-gray-400'
                        }`}>
                          #{i + 1}
                        </span>
                        {/* 头像 */}
                        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 text-white ${
                          r.gender === 'female' ? 'bg-gradient-to-br from-pink-300 to-rose-400' :
                          r.gender === 'male' ? 'bg-gradient-to-br from-blue-300 to-cyan-400' :
                          'bg-gradient-to-br from-gray-300 to-gray-400'
                        }`}>
                          {r.nickname[0]}
                        </span>
                        {/* 信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-800 truncate">{r.nickname}</span>
                            <span className="text-xs text-gray-400">{GENDER_LABELS[r.gender]}</span>
                            {r.school && <span className="text-xs text-pink-400 shrink-0">{r.school}</span>}
                          </div>
                          {/* 匹配原因摘要 */}
                          {r.reasons && r.reasons.length > 0 && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                              {r.reasons.slice(0, 2).join(' · ')}
                              {r.reasons.length > 2 && ` ...`}
                            </p>
                          )}
                        </div>
                        {/* 分数条 */}
                        <div className="flex items-center gap-2 w-36 shrink-0">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${
                              r.score >= 76 ? 'bg-gradient-to-r from-green-400 to-emerald-300' :
                              r.score >= 50 ? 'bg-gradient-to-r from-yellow-300 to-amber-300' :
                              'bg-gradient-to-r from-red-300 to-orange-300'
                            }`} style={{ width: `${r.score}%` }} />
                          </div>
                          <span className={`text-sm font-bold w-10 text-right shrink-0 ${
                            r.score >= 76 ? 'text-green-500' : r.score >= 50 ? 'text-yellow-500' : 'text-red-400'
                          }`}>{r.score}%</span>
                        </div>
                        {/* 操作：填入手动配对 */}
                        <button
                          onClick={() => {
                            setManualUserA(recUserId as number)
                            setManualUserB(r.userId)
                            setRecManualTarget(r.userId)
                            // 切换到执行匹配tab
                            setTab('match')
                          }}
                          className="shrink-0 px-3 py-1.5 text-xs font-medium border rounded-lg transition
                            border-pink-200 text-pink-600 hover:bg-pink-50 opacity-0 group-hover:opacity-100"
                          title="将此二人设为手动配对目标"
                        >
                          ✋ 配对
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {recManualTarget !== null && (
              <div className="rounded-xl p-3 bg-blue-50/80 border border-blue-200 text-sm text-blue-700 animate-fade-in">
                💡 已自动填入手动配对区域（ID: {recUserId} ↔ ID: {recManualTarget}），切换到「执行匹配」tab 可直接确认配对。
              </div>
            )}
          </div>
        )}

        {/* GPS 定位反馈 */}
        {tab === 'gps-feedback' && (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-700">📍 用户定位反馈</h3>
              <p className="text-xs text-gray-400 mt-1">用户反馈 GPS 定位不准确时提交的坐标信息</p>
            </div>
            {gpsFeedbacks.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">暂无反馈</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed" style={{ minWidth: '800px' }}>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-gray-500 font-medium" style={{width:'5%'}}>ID</th>
                      <th className="px-3 py-3 text-left text-gray-500 font-medium" style={{width:'18%'}}>GPS 坐标</th>
                      <th className="px-3 py-3 text-center text-gray-500 font-medium" style={{width:'8%'}}>精度</th>
                      <th className="px-3 py-3 text-left text-gray-500 font-medium" style={{width:'14%'}}>定位结果</th>
                      <th className="px-3 py-3 text-left text-gray-500 font-medium" style={{width:'14%'}}>实际学校</th>
                      <th className="px-3 py-3 text-left text-gray-500 font-medium" style={{width:'16%'}}>时间</th>
                      <th className="px-3 py-3 text-center text-gray-500 font-medium" style={{width:'8%'}}>操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {gpsFeedbacks.map((fb: any) => (
                      <tr key={fb.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-gray-400">#{fb.id}</td>
                        <td className="px-3 py-3 font-mono text-xs text-gray-600">
                          {Number(fb.latitude).toFixed(6)}, {Number(fb.longitude).toFixed(6)}
                          <button
                            onClick={() => safeCopy(`${fb.latitude},${fb.longitude}`)}
                            className="ml-1 text-gray-300 hover:text-pink-400 transition"
                                                            title="复制坐标">📋</button>
                          <a
                            href={`https://uri.amap.com/marker?position=${fb.longitude},${fb.latitude}&name=反馈点`}
                            target="_blank" rel="noopener noreferrer"
                            className="ml-1 text-blue-400 hover:text-blue-600 transition"
                                                            title="在高德地图中查看">🗺️</a>
                        </td>
                        <td className="px-3 py-3 text-center text-gray-500">{fb.accuracy ? `${Math.round(fb.accuracy)}m` : '-'}</td>
                        <td className="px-3 py-3 text-gray-600">{fb.detectedSchool || '-'}</td>
                        <td className="px-3 py-3 text-orange-600 font-medium">{fb.actualSchool || '-'}</td>
                        <td className="px-3 py-3 text-gray-400 text-xs">{formatBeijingTime(fb.createdAt)}</td>
                        <td className="px-3 py-3 text-center">
                          <button onClick={() => deleteGpsFeedback(fb.id)}
                            className="text-xs text-gray-300 hover:text-red-400 transition">删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-xl hover:opacity-90 disabled:opacity-50 transition text-[#8b4a54]">
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
                      className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                      disabled={settingViewPw} />
                  )}
                  <input
                    type="password"
                    placeholder={hasViewPassword ? '新的查看详情密码' : '设置查看详情密码（至少8位，含字母和数字）'}
                    value={viewPwInput}
                    onChange={e => setViewPwInput(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    disabled={settingViewPw} />
                  {hasViewPassword && (
                    <input
                      type="password"
                      placeholder="确认新密码"
                      value={viewPwConfirm}
                      onChange={e => setViewPwConfirm(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSetViewPassword() }}
                      className="w-full px-4 py-2.5 bg-white/60 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                      disabled={settingViewPw} />
                  )}
                  <button onClick={handleSetViewPassword}
                    disabled={settingViewPw || !viewPwInput || (hasViewPassword && (!viewPwCurrent || !viewPwConfirm))}
                    className={`px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-stone-500 to-sky-400 rounded-xl hover:opacity-90 disabled:opacity-50 transition`}>
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
          <div className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-modal-in" onClick={e => e.stopPropagation()}>
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
                className={`flex-1 px-4 py-2.5 text-sm font-semibold bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-xl hover:opacity-90 transition text-[#8b4a54] ${
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
          <div className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-modal-in" onClick={e => e.stopPropagation()}>
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
                matchVerifyError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-stone-400'
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
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-stone-500 to-sky-400 rounded-xl hover:opacity-90 transition ${
                  matchVerifyingPw || !matchVerifyPassword.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {matchVerifyingPw ? '验证中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 验证状态修改弹窗 */}
      {editVerifOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditVerifOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 animate-modal-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">修改验证状态</h3>
            <p className="text-sm text-gray-500 mb-4">用户：<span className="font-medium text-gray-700">{editVerifNickname}</span></p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">验证状态</label>
                <select
                  value={editVerifStatus}
                  onChange={e => setEditVerifStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                >
                  <option value="verified_student">✅ 已验证</option>
                  <option value="pending_verification">⏳ 待验证</option>
                  <option value="verification_failed">❌ 未通过</option>
                  <option value="null">— 未设置</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">验证分数（可选）</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={editVerifScore}
                  onChange={e => setEditVerifScore(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="留空则清除分数"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditVerifOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                取消
              </button>
              <button onClick={handleSaveVerif} disabled={editVerifLoading}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-xl hover:opacity-90 transition text-[#8b4a54] ${
                  editVerifLoading ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {editVerifLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 安全等级修改弹窗 */}
      {editSafetyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditSafetyOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 animate-modal-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">修改安全等级</h3>
            <p className="text-sm text-gray-500 mb-4">用户：<span className="font-medium text-gray-700">{editSafetyNickname}</span></p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">安全等级</label>
                <select
                  value={editSafetyLevel}
                  onChange={e => setEditSafetyLevel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                >
                  <option value="normal">✅ 正常</option>
                  <option value="restricted">⚠️ 受限</option>
                  <option value="blocked">🚫 封禁</option>
                  <option value="null">— 重置（自动计算）</option>
                </select>
              </div>
              <p className="text-xs text-gray-400">
                选「重置」则清除手动设置，等级将由问卷自动计算。
              </p>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditSafetyOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                取消
              </button>
              <button onClick={handleSaveSafety} disabled={editSafetyLoading}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold bg-gradient-to-r from-stone-100 to-stone-300 rounded-xl hover:opacity-90 transition text-stone-700 ${
                  editSafetyLoading ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {editSafetyLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改学校弹窗 */}
      {editSchoolOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditSchoolOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 animate-modal-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">修改所属学校</h3>
            <p className="text-sm text-gray-500 mb-4">用户：<span className="font-medium text-gray-700">{editSchoolNickname}</span></p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">学校</label>
                <select
                  value={editSchoolValue}
                  onChange={e => setEditSchoolValue(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                >
                  <option value="null">— 清除学校</option>
                  <option value="吉林大学">吉林大学（985）</option>
                  <option value="东北师范大学">东北师范大学（211）</option>
                  <option value="吉林动画学院">吉林动画学院</option>
                  <option value="长春大学">长春大学</option>
                  <option value="长春理工大学">长春理工大学</option>
                  <option value="长春工业大学">长春工业大学</option>
                  <option value="吉林建筑大学">吉林建筑大学</option>
                  <option value="吉林农业大学">吉林农业大学</option>
                  <option value="长春中医药大学">长春中医药大学</option>
                  <option value="吉林工程技术师范学院">吉林工程技术师范学院</option>
                  <option value="长春师范大学">长春师范大学</option>
                  <option value="吉林财经大学">吉林财经大学</option>
                  <option value="吉林体育学院">吉林体育学院</option>
                  <option value="吉林艺术学院">吉林艺术学院</option>
                  <option value="吉林工商学院">吉林工商学院</option>
                  <option value="长春工程学院">长春工程学院</option>
                  <option value="吉林警察学院">吉林警察学院</option>
                  <option value="长春汽车职业技术大学">长春汽车职业技术大学</option>
                  <option value="长春职业技术大学">长春职业技术大学</option>
                  <option value="吉林外国语大学">吉林外国语大学</option>
                  <option value="长春光华学院">长春光华学院</option>
                  <option value="长春工业大学人文信息学院">长春工业大学人文信息学院</option>
                  <option value="长春电子科技学院">长春电子科技学院</option>
                  <option value="长春财经学院">长春财经学院</option>
                  <option value="吉林建筑科技学院">吉林建筑科技学院</option>
                  <option value="长春建筑学院">长春建筑学院</option>
                  <option value="长春科技学院">长春科技学院</option>
                  <option value="长春大学旅游学院">长春大学旅游学院</option>
                  <option value="长春人文学院">长春人文学院</option>
                </select>
              </div>
              <p className="text-xs text-gray-400">
                修改学校后，用户的匹配池将基于新学校重新计算。
              </p>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditSchoolOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                取消
              </button>
              <button onClick={handleSaveSchool} disabled={editSchoolLoading}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold bg-gradient-to-r from-stone-100 to-stone-300 rounded-xl hover:opacity-90 transition text-stone-700 ${
                  editSchoolLoading ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {editSchoolLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除用户二级密码确认弹窗 */}
      {deletePwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDeletePwModal(false)}>
          <div className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-modal-in" onClick={e => e.stopPropagation()}>
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
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-amber-200 rounded-xl hover:opacity-90 transition ${
                  deletingConfirmed || !deletePw.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {deletingConfirmed ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重置用户密码弹窗 */}
      {resetPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setResetPwModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-modal-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-stone-600 mb-1">🔑 重置用户密码</h3>
            <p className="text-sm text-gray-400 mb-4">为用户「<span className="font-medium text-gray-600">{resetPwNickname}</span>」设置新密码</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">新密码</label>
                <input
                  type="password"
                  value={resetPwNew}
                  onChange={e => { setResetPwNew(e.target.value); setResetPwError('') }}
                  placeholder="至少8位，含字母和数字"
                  autoFocus
                  className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition ${
                    resetPwError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-stone-400'
                  }`}
                  disabled={resettingPw}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">确认新密码</label>
                <input
                  type="password"
                  value={resetPwConfirm}
                  onChange={e => { setResetPwConfirm(e.target.value); setResetPwError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleResetPassword() }}
                  placeholder="再次输入新密码"
                  className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition ${
                    resetPwError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-stone-400'
                  }`}
                  disabled={resettingPw}
                />
              </div>
              {resetPwError && <p className="text-xs text-red-500">{resetPwError}</p>}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setResetPwModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                取消
              </button>
              <button onClick={handleResetPassword} disabled={resettingPw || !resetPwNew.trim() || !resetPwConfirm.trim()}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-stone-500 to-stone-400 rounded-xl hover:opacity-90 transition ${
                  resettingPw ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {resettingPw ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* ═══════════ 📧 群发邮件 Tab ═══════════ */}
        {tab === 'broadcast' && (
          <div className="space-y-5">
            {/* 邮件内容编辑区 */}
            <div className="glass-card rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-gray-800">✏️ 编辑邮件</h3>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">邮件标题 *</label>
                <input
                  type="text"
                  value={broadcastSubject}
                  onChange={e => setBroadcastSubject(e.target.value)}
                  placeholder="请输入邮件标题"
                  maxLength={200}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-300 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">邮件内容 *（支持 HTML）</label>
                <textarea
                  value={broadcastContent}
                  onChange={e => setBroadcastContent(e.target.value)}
                  placeholder="请输入邮件内容，支持 HTML 标签（如 &lt;b&gt;粗体&lt;/b&gt;、&lt;br&gt; 换行等）"
                  rows={8}
                  maxLength={100000}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-pink-300 focus:border-pink-300 outline-none transition resize-y"
                />
                <p className="text-xs text-gray-400 mt-1">{broadcastContent.length.toLocaleString()} / 100,000 字符</p>
              </div>
            </div>

            {/* 用户选择区 */}
            <div className="glass-card rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-800">👥 选择收件人</h3>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={broadcastSelectAll}
                      onChange={e => {
                        setBroadcastSelectAll(e.target.checked)
                        if (e.target.checked) {
                          setBroadcastUserIds(new Set())
                        } else {
                          setBroadcastUserIds(new Set(broadcastUsers.map((u: any) => u.id)))
                        }
                      }}
                      className="w-4 h-4 accent-pink-500"
                    />
                    全部用户
                  </label>
                  <span className="text-xs text-gray-400">
                    {broadcastSelectAll
                      ? `已选全部 (${broadcastUsers.length} 人)`
                      : `已选 ${broadcastUsers.length - broadcastUserIds.size} / ${broadcastUsers.length} 人`
                    }
                  </span>
                </div>
              </div>

              {!broadcastLoaded ? (
                <div className="text-center py-8 text-gray-400 text-sm">⏳ 加载用户列表...</div>
              ) : broadcastUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">暂无用户</div>
              ) : (
                <div className="max-h-60 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                  {broadcastUsers.map((u: any) => (
                    <label key={u.id} className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-pink-50/30 transition ${
                      !broadcastSelectAll && broadcastUserIds.has(u.id) ? 'bg-pink-50' : ''
                    }`}>
                      <input
                        type="checkbox"
                        checked={!broadcastUserIds.has(u.id)}
                        onChange={() => {
                          const next = new Set(broadcastUserIds)
                          if (next.has(u.id)) next.delete(u.id)
                          else next.add(u.id)
                          setBroadcastUserIds(next)
                        }}
                        disabled={broadcastSelectAll}
                        className="w-4 h-4 accent-pink-500"
                      />
                      <span className="text-sm text-gray-700 flex-1 truncate">{u.nickname}</span>
                      <span className="text-xs text-gray-400 shrink-0">{u.email}</span>
                    </label>
                  ))}
                </div>
              )}

              {!broadcastSelectAll && broadcastUserIds.size > 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                  ⚠️ 已排除 {broadcastUserIds.size} 个用户（取消勾选的用户将不会收到邮件）
                </p>
              )}
            </div>

            {/* 发送设置 */}
            <div className="glass-card rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-gray-800">⚙️ 发送设置</h3>
              <div className="flex items-center gap-4">
                <label className="text-sm text-gray-600 whitespace-nowrap">发送间隔：</label>
                <select
                  value={broadcastInterval}
                  onChange={e => setBroadcastInterval(Number(e.target.value))}
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-pink-300 outline-none"
                >
                  <option value={3}>3 秒（快，可能触发限速）</option>
                  <option value={5}>5 秒（推荐）</option>
                  <option value={10}>10 秒（安全）</option>
                  <option value={15}>15 秒（非常安全）</option>
                  <option value={20}>20 秒（保守）</option>
                </select>
                <span className="text-xs text-gray-400">
                  {broadcastUsers.length > 0 &&
                    `预计耗时约 ${Math.ceil(broadcastUsers.length * broadcastInterval / 60)} 分钟`
                  }
                </span>
              </div>
            </div>

            {/* 操作按钮 + 结果展示 */}
            <div className="glass-card rounded-2xl p-6 space-y-4">
              <button
                onClick={handleBroadcastSend}
                disabled={broadcastSending || !broadcastSubject.trim() || !broadcastContent.trim() || broadcastUsers.length === 0}
                className={`w-full py-3 rounded-xl text-sm font-bold transition ${
                  broadcastSending || !broadcastSubject.trim() || !broadcastContent.trim()
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-[#ec4899] to-[#a855f7] text-white hover:opacity-90 shadow-lg'
                }`}
              >
                {broadcastSending
                  ? `📤 发送中...`
                  : `📧 确认发送 ${broadcastSelectAll ? `给全部 ${broadcastUsers.length} 位用户` : `给 ${broadcastUsers.length - broadcastUserIds.size} 位用户`}`
                }
              </button>

              {/* 实时进度/结果 */}
              {broadcastResult && (
                <div className={`rounded-xl p-4 ${
                  broadcastResult.error ? 'bg-red-50' : broadcastResult.sent !== undefined ? 'bg-green-50' : 'bg-gray-50'
                }`}>
                  {broadcastResult.error ? (
                    <div>
                      <p className="font-bold text-red-600 text-sm">❌ 发送失败</p>
                      <p className="text-red-500 text-sm mt-1">{broadcastResult.error}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-bold text-green-700 text-sm">
                        ✅ 发送完成！成功 {broadcastResult.sent} 封，失败 {broadcastResult.failed} 封
                      </p>
                      {broadcastResult.results && (
                        <details className="mt-2">
                          <summary className="text-xs text-green-600 cursor-pointer hover:text-green-800">
                            展开查看详细结果 ({broadcastResult.results.length} 条)
                          </summary>
                          <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                            {broadcastResult.results.map((r: any, i: number) => (
                              <div key={i} className={`text-xs px-2 py-1 rounded ${r.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                                {r.ok ? '✅' : '❌'} {r.nickname} ({r.email}){!r.ok && r.error ? ` — ${r.error}` : ''}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

