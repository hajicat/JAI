// src/lib/week.ts
// 周期管理：自定义周边界（周日 12:00 北京时间 = 周日 04:00 UTC）
//
// 设计：
//   - 匹配触发窗口：北京时间周日 12:00 之后（UTC 周日 04:00+）
//   - 周日 12:00 之前完成问卷的人 → 进入当周匹配池
//   - 周日 12:00 之后完成问卷的人 → 进入下一周匹配池（因为本周已开始匹配）

/**
 * 计算某一天的 ISO 8601 周数（纯 UTC，无时区依赖）
 * ISO 定义：含周四的那一周属于该年，周一为周首
 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayOfWeek = d.getUTCDay() || 7         // 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek)  // 找到本周四
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  )
  return { year: d.getUTCFullYear(), week: weekNum }
}

/**
 * 获取当前匹配周期的 week_key
 *
 * 自定义周边界：周一 00:00 北京时间 ~ 周日 12:00 北京时间 = 同一个周期
 * 北京时间周日 12:00（UTC 周日 04:00）之后 → 算"下一周"
 *
 * 为什么用 UTC 而不是本地时间？
 *   Cloudflare Edge Runtime 分布在全球各地运行，
 *   本地时间 (getDay/getDate) 在不同 edge node 上结果不同。
 *   UTC 是唯一可靠的跨地域基准。
 */
export function getWeekKey(): string {
  const now = new Date()
  const utcDay = now.getUTCDay()
  const utcHours = now.getUTCHours()

  // 北京时间周日 12:00 之后（UTC 周日 04:00+）
  // 此时本周匹配已经开始/完成，新填问卷的人应该进下一周的池子
  if (utcDay === 0 && utcHours >= 4) {
    // 用昨天（周六）的日期来算 ISO 周 → 得到"上一周"的 key
    const saturday = new Date(now)
    saturday.setUTCDate(saturday.getUTCDate() - 1)
    const { year, week } = getISOWeek(saturday)
    return `${year}-W${String(week).padStart(2, '0')}`
  }

  const { year, week } = getISOWeek(now)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * 判断当前是否在匹配窗口内（北京时间周日 12:00 ~ 下周一 12:00 前）
 * 即：UTC 周日 04:00 ~ 周一 03:59
 */
export function isMatchingWindow(): boolean {
  const now = new Date()
  const utcDay = now.getUTCDay()
  const utcHours = now.getUTCHours()
  return utcDay === 0 && utcHours >= 4
}

/**
 * 判断当前是否已过揭晓时间（北京时间周日 20:00 = UTC 周日 12:00 之后）
 * 匹配在周日 12:00 执行，但结果要等到 20:00 才向用户展示
 */
export function isRevealWindow(): boolean {
  const now = new Date()
  const utcDay = now.getUTCDay()
  const utcHours = now.getUTCHours()
  return utcDay === 0 && utcHours >= 12
}

/**
 * 从日期字符串计算 week_key（管理员手动指定匹配日期时使用）
 * 与 getWeekKey 使用相同的 UTC 基准和周边界规则
 */
export function dateToWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z') // 强制按 UTC 零点解析
  if (isNaN(d.getTime())) return getWeekKey()

  const { year, week } = getISOWeek(d)
  return `${year}-W${String(week).padStart(2, '0')}`
}
