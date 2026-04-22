/**
 * 地理位置工具函数（多校区版）
 *
 * 覆盖学校：
 *   - 吉林动画学院（任意邮箱，2km）
 *   - 吉林艺术学院（任意邮箱，2km）
 *   - 吉林大学（7 个校区，@jlu / @mails.jlu 校内邮箱，2km）
 *   - 东北师范大学（2 个校区，@nenu 校内邮箱，2km）
 *   - 吉林外国语大学（1 个校区，@jisu 校内邮箱）
 *   - 长春大学（2+ 个校区，任意邮箱 — 无官方学生邮箱后缀）
 *   - 长春理工大学（1 个校区，@mails.cust 校内邮箱）
 */

/** 地球半径（公里） */
export const EARTH_RADIUS_KM = 6371

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

// ════════════════════════════════════════════
// 校区坐标数据
// ════════════════════════════════════════════

interface Campus {
  name: string           // 校区名称
  lat: number            // 纬度
  lng: number            // 经度
  schoolName: string     // 所属学校全称
  schoolShort: string    // 学校简称
  radiusKm: number       // GPS 验证半径（km）
}

/**
 * 所有校区的 GPS 坐标列表
 *
 * ─── 吉林动画学院 + 长春大学（任意邮箱） ──────
 * ─── 吉林大学 + 东师 + 吉外（需校内邮箱）──────
 */

const CAMPUSES: Campus[] = [
  // ── 吉林动画学院（任意邮箱，2km） ───────────────
  // GCJ-02: 吉林动画学院(高新校区)
  { name: '吉林动画学院',        lat: 43.820362, lng: 125.261993,
    schoolName: '吉林动画学院', schoolShort: '吉动', radiusKm: 1.0 },

  // ── 吉林艺术学院（任意邮箱） ──────────────────────
  // GCJ-02: 主校区 + 红旗校区
  { name: '吉林艺术学院',        lat: 43.862015, lng: 125.31046,
    schoolName: '吉林艺术学院', schoolShort: '吉艺', radiusKm: 1.5 },
  { name: '吉艺红旗校区',       lat: 43.86179, lng: 125.310278,
    schoolName: '吉林艺术学院', schoolShort: '吉艺', radiusKm: 1.0 },

  // ── 长春大学（任意邮箱 — 无官方学生邮箱后缀） ─
  // GCJ-02: 卫星路南 + 东校区(图书馆)
  { name: '长春大学(卫星路南)',   lat: 43.830861, lng: 125.299475,
    schoolName: '长春大学',      schoolShort: '长大', radiusKm: 1.0 },
  { name: '长春大学(东校区)',     lat: 43.834209, lng: 125.320884,
    schoolName: '长春大学',      schoolShort: '长大', radiusKm: 1.0 },

  // ── 吉林大学（7 个校区，全部 2km，@jlu / @mails.jlu 校内邮箱） ──
  // GCJ-02 高德地图精确坐标
  { name: '吉林大学(前卫南区)',   lat: 43.823755, lng: 125.277062,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉林大学(前卫北区)',   lat: 43.879464, lng: 125.319115,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉林大学(南岭校区)',   lat: 43.857075, lng: 125.335348,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉林大学(和平校区)',   lat: 43.911280, lng: 125.267357,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉林大学(朝阳校区)',   lat: 43.883165, lng: 125.307354,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉林大学(南湖校区)',   lat: 43.847944, lng: 125.293245,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉林大学(新民校区)',   lat: 43.870203, lng: 125.310869,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },

  // ── 东北师范大学（2 个校区，全部 2km，@nenu 校内邮箱） ──
  // GCJ-02 高德地图精确坐标
  { name: '东北师范(人民大街)',  lat: 43.861880, lng: 125.331370,
    schoolName: '东北师范大学',  schoolShort: '东师', radiusKm: 2.0 },
  { name: '东北师范净月校区',    lat: 43.826195, lng: 125.425650,
    schoolName: '东北师范大学',  schoolShort: '东师', radiusKm: 2.0 },

  // ── 吉林外国语大学（@jisu 校内邮箱） ──
  // GCJ-02: 净月大街3658号
  { name: '吉林外国语大学',      lat: 43.822169, lng: 125.445172,
    schoolName: '吉林外国语大学',schoolShort: '吉外', radiusKm: 1.15 },

  // ── 长春理工大学（@mails.cust 校内邮箱） ──
  // GCJ-02: 卫星路7186号
  { name: '长春理工大学',        lat: 43.83327,  lng: 125.30751,
    schoolName: '长春理工大学',  schoolShort: '长理工', radiusKm: 1.5 },
]

// ════════════════════════════════════════════
// 验证逻辑
// ════════════════════════════════════════════

/** 判断是否在吉林动画学院范围内（允许任意邮箱注册） */
function isJLAI(lat: number, lng: number): boolean {
  const jlai = CAMPUSES[0]
  return haversineDistance(jlai.lat, jlai.lng, lat, lng) <= jlai.radiusKm
}

/** 单个匹配校区（用于前端下拉选择） */
export interface NearbyCampus {
  name: string           // 校区名称，如 "吉林大学(前卫南区)"
  schoolName: string     // 学校全称，如 "吉林大学"
  schoolShort: string    // 简称，如 "吉大"
  distanceKm: number     // 用户到该校区的距离（km）
  requiresSchoolEmail: boolean // 该学校是否需要校内邮箱
}

/**
 * 查找用户所在的匹配校区
 * 返回所有在范围内的校区列表 + 是否需要校内邮箱（以最近校区为准）
 *
 * 当多个校区重叠时返回 nearbyCampuses 数组供用户选择，
 * 默认选中离用户最近的那个。
 */
export function verifyLocation(lat: number, lng: number):
  | { valid: false; message: string; nearestCampus?: string; nearestDistance?: number }
  | { valid: true; location: string; requiresSchoolEmail: boolean; nearestCampus: string; nearestDistance: number; nearbyCampuses: NearbyCampus[] } {

  // 收集所有在范围内的校区 + 记录最近的
  const matchingCampuses: NearbyCampus[] = []
  let nearestCampus: Campus | null = null
  let nearestDist = Infinity

  for (const c of CAMPUSES) {
    const dist = haversineDistance(c.lat, c.lng, lat, lng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearestCampus = c
    }
    if (dist <= c.radiusKm) {
      matchingCampuses.push({
        name: c.name,
        schoolName: c.schoolName,
        schoolShort: c.schoolShort,
        distanceKm: Math.round(dist * 100) / 100,
        requiresSchoolEmail: c.schoolShort !== '吉动' && c.schoolShort !== '长大' && c.schoolShort !== '吉艺',
      })
    }
  }

  // 按距离排序（最近的在前）
  matchingCampuses.sort((a, b) => a.distanceKm - b.distanceKm)

  if (matchingCampuses.length > 0) {
    const selected = matchingCampuses[0] // 默认选最近的
    return {
      valid: true,
      location: `${selected.schoolName}(${selected.name})`,
      requiresSchoolEmail: selected.requiresSchoolEmail,
      nearestCampus: selected.name,
      nearestDistance: selected.distanceKm,
      nearbyCampuses: matchingCampuses,
    }
  }

  // 未在任何校区内，返回最近校区作为提示
  if (nearestCampus && nearestDist <= 10) {
    return {
      valid: false,
      message: `你当前不在任何校区范围内。最近的「${nearestCampus.name}」距离 ${(nearestDist).toFixed(1)}km，请到校园内再试`,
      nearestCampus: nearestCampus.name,
      nearestDistance: Math.round(nearestDist * 100) / 100,
    }
  }

  return {
    valid: false,
    message: 'GPS 定位显示您不在长春高校区域内，无法使用此平台',
  }
}

/**
 * GPS 采样评分（用于问卷提交时的学生验证）
 * 适用于：吉林动画学院、长春大学（无学校邮箱，需要连续采样验证）
 *
 * 评分维度：
 * - 校内命中数（主要）
 * - 位置稳定性（采样点之间距离）
 * - 采样点数量（至少要有 2 个）
 *
 * @param samples GPS 采样点数组 [{ lat, lng, accuracy?, timestamp? }]
 * @param schoolShort 学校简称（'吉动' | '长大'）
 * @returns 评分（0-100），及诊断信息
 */
export function scoreGpsSamples(
  samples: Array<{ lat: number; lng: number; accuracy?: number; timestamp?: number }>,
  schoolShort: string
): { score: number; details: string } {
  const CAMPUS_MAP: Record<string, { lat: number; lng: number; radiusKm: number }> = {
    '吉动': { lat: 43.820362, lng: 125.261993, radiusKm: 1.0 },
    '长大': { lat: 43.830861, lng: 125.299475, radiusKm: 1.0 },
    '吉艺': { lat: 43.862015, lng: 125.31046, radiusKm: 1.5 },
  }

  const campus = CAMPUS_MAP[schoolShort]
  if (!campus) {
    return { score: 0, details: '未知学校类型，无需 GPS 验证' }
  }

  if (!samples || samples.length === 0) {
    return { score: 0, details: '无 GPS 采样数据' }
  }

  // 总采样数
  const sampleCount = samples.length
  let insideCount = 0
  const validDistances: number[] = [] // 仅有效采样的校内距离
  let validSampleCount = 0              // 有效采样数（精度合理的）

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    // 精度 > 200m 的采样点视为无效，不参与评分（可能是 GPS 信号差）
    if (s.accuracy && s.accuracy > 200) continue
    validSampleCount++
    const dist = haversineDistance(campus.lat, campus.lng, s.lat, s.lng)
    validDistances.push(dist)
    if (dist <= campus.radiusKm) {
      insideCount++
    }
  }

  // 基础分：以有效采样数计算（防止低精度无效采样拉低分数）
  const effectiveCount = validSampleCount || sampleCount
  const countBonus = Math.min(effectiveCount * 10, 30) // 最多 30 分

  // 位置稳定性评分（基于有效采样点的校内平均距离）
  let stabilityBonus = 0
  if (validDistances.length >= 2) {
    const avgDist = validDistances.reduce((a, b) => a + b, 0) / validDistances.length
    // 校内平均距离越小越稳定
    const stableBonus = Math.max(0, 20 - avgDist * 10) // 校内平均距离 0→20分，2km→0分
    stabilityBonus = Math.round(stableBonus)
  }

  // 校内命中比例（主要指标，基于有效采样）
  const insideRatio = effectiveCount > 0 ? insideCount / effectiveCount : 0
  const insideBonus = Math.round(insideRatio * 50) // 最多 50 分

  // GPS 精度加权（精度合理 10-100m 的采样点权重更高；<5m 可能为虚拟定位）
  let weightedInsideRatio = insideCount
  let totalWeight = effectiveCount
  for (const s of samples) {
    if (s.accuracy && s.accuracy > 5 && s.accuracy <= 100) {
      // 合理精度（6-100m）额外加权
      weightedInsideRatio += 0.1
      totalWeight += 0.1
    }
  }
  const precisionBonus = effectiveCount > 0
    ? Math.round((weightedInsideRatio / totalWeight) * 10)
    : 0 // 最多 10 分

  const totalScore = Math.min(countBonus + insideBonus + stabilityBonus + precisionBonus, 100)

  const invalidCount = sampleCount - validSampleCount
  const details = [
    `采样${sampleCount}次（有效${validSampleCount}次${invalidCount > 0 ? `，精度过差${invalidCount}次已排除` : ''}）`,
    `校内命中${insideCount}次（${Math.round(insideRatio * 100)}%）`,
    `位置稳定性+${stabilityBonus}，精度加权+${precisionBonus}`,
    `总评分：${totalScore}`,
  ].join('；')

  return { score: totalScore, details }
}

/**
 * 判断用户是否为"无邮箱验证学校"（吉动/长大）
 * 这类用户在问卷提交时需要 GPS 采样验证
 */
export function isNoEmailSchool(schoolShort: string): boolean {
  return schoolShort === '吉动' || schoolShort === '长大' || schoolShort === '吉艺'
}
