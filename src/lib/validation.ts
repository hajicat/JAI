// Input validation utilities

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NICKNAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9_\-·]{1,20}$/
const INVITE_CODE_REGEX = /^JLAI-[A-F0-9]{16}$/

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') return { valid: false, error: '邮箱不能为空' }
  if (email.length > 254) return { valid: false, error: '邮箱过长' }
  if (!EMAIL_REGEX.test(email)) return { valid: false, error: '邮箱格式不正确' }
  return { valid: true }
}

export function validatePassword(password: string): ValidationResult {
  if (!password || typeof password !== 'string') return { valid: false, error: '密码不能为空' }
  if (password.length < 8) return { valid: false, error: '密码至少8个字符' }
  if (password.length > 128) return { valid: false, error: '密码过长' }
  // Require at least one letter and one number
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: '密码必须包含字母和数字' }
  }
  return { valid: true }
}

export function validateNickname(nickname: string): ValidationResult {
  if (!nickname || typeof nickname !== 'string') return { valid: false, error: '昵称不能为空' }
  const trimmed = nickname.trim()
  if (trimmed.length < 1) return { valid: false, error: '昵称不能为空' }
  if (trimmed.length > 20) return { valid: false, error: '昵称最多20个字符' }
  // Allow Chinese, letters, numbers, common punctuation
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-\·\s]{1,20}$/.test(trimmed)) {
    return { valid: false, error: '昵称包含非法字符' }
  }
  return { valid: true }
}

export function validateInviteCode(code: string): ValidationResult {
  if (!code || typeof code !== 'string') return { valid: false, error: '邀请码不能为空' }
  if (!INVITE_CODE_REGEX.test(code.toUpperCase())) {
    return { valid: false, error: '邀请码格式不正确' }
  }
  return { valid: true }
}

export function sanitizeString(input: string, maxLength: number = 500): string {
  if (typeof input !== 'string') return ''
  // Remove null bytes and control characters (except newline/tab)
  return input
    .replace(/\0/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, maxLength)
    .trim()
}

export function validateContactInfo(info: string): ValidationResult {
  if (!info || typeof info !== 'string') return { valid: false, error: '联系方式不能为空' }
  const trimmed = info.trim()
  if (trimmed.length < 2) return { valid: false, error: '联系方式太短' }
  if (trimmed.length > 100) return { valid: false, error: '联系方式过长' }
  // No scripts or HTML
  if (/<[^>]*>/.test(trimmed) || /javascript:/i.test(trimmed)) {
    return { valid: false, error: '联系方式包含非法内容' }
  }
  return { valid: true }
}

export function validateSurveyAnswer(value: string): ValidationResult {
  if (typeof value !== 'string') return { valid: false, error: '答案格式错误' }
  if (value.length > 200) return { valid: false, error: '答案过长' }
  return { valid: true }
}
