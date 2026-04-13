/**
 * 地理位置工具函数（多校区版）
 *
 * 覆盖学校：
 *   - 吉林动画学院（任意邮箱，2km）
 *   - 吉林大学（7 个校区，@jlu / @mails.jlu 校内邮箱，2km）
 *   - 东北师范大学（2 个校区，@nenu 校内邮箱，2km）
 *   - 吉林外国语大学（1 个校区，@jisu 校内邮箱）
 *   - 长春大学（2+ 个校区，任意邮箱 — 无官方学生邮箱后缀）
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
    schoolName: '吉林动画学院', schoolShort: '吉动', radiusKm: 2.0 },

  // ── 长春大学（任意邮箱 — 无官方学生邮箱后缀） ─
  // GCJ-02: 卫星路南 + 东校区(图书馆)
  { name: '长春大学(卫星路南)',   lat: 43.830861, lng: 125.299475,
    schoolName: '长春大学',      schoolShort: '长大', radiusKm: 1.0 },
  { name: '长春大学(东校区)',     lat: 43.834209, lng: 125.320884,
    schoolName: '长春大学',      schoolShort: '长大', radiusKm: 0.65 },

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
]

// ════════════════════════════════════════════
// 验证逻辑
// ════════════════════════════════════════════

/** 判断是否在吉林动画学院范围内（允许任意邮箱注册） */
function isJLAI(lat: number, lng: number): boolean {
  const jlai = CAMPUSES[0]
  return haversineDistance(jlai.lat, jlai.lng, lat, lng) <= jlai.radiusKm
}

/**
 * 查找用户所在的匹配校区
 * 返回最近的校区信息 + 是否需要校内邮箱
 */
export function verifyLocation(lat: number, lng: number):
  | { valid: false; message: string; nearestCampus?: string; nearestDistance?: number }
  | { valid: true; location: string; requiresSchoolEmail: boolean; nearestCampus: string; nearestDistance: number } {

  // 检查是否在任一校区范围内（每个校区有独立半径）
  let nearestCampus: Campus | null = null
  let nearestDist = Infinity

  for (const c of CAMPUSES) {
    const dist = haversineDistance(c.lat, c.lng, lat, lng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearestCampus = c
    }
    if (dist <= c.radiusKm) {
      return {
        valid: true,
        location: `${c.schoolName}(${c.name})`,
        requiresSchoolEmail: c.schoolShort !== '吉动' && c.schoolShort !== '长大',
        nearestCampus: c.name,
        nearestDistance: Math.round(dist * 100) / 100,
      }
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
