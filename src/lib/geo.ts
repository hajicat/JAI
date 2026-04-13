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

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2:2): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * atan2(Math.sqrt(a), Math.sqrt(1 - a))
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
  // ── 吉林动画学院（2km，任意邮箱） ──
  { name: '吉林动画学院',        lat: 43.8175, lng: 125.2561,
    schoolName: '吉林动画学院', schoolShort: '吉动', radiusKm: 2.0 },

  // ── 吉林大学（7 个校区，全部 2km，校内邮箱） ──
  { name: '吉大前卫南区',       lat: 43.8277, lng: 125.3129,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉大前卫北区',       lat: 43.8670, lng: 125.3080,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉大南岭校区',       lat: 43.8590, lng: 125.2950,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉大南湖校区',       lat: 43.8500, lng: 125.3050,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉大新民校区',       lat: 43.8700, lng: 125.3100,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉大朝阳校区',       lat: 43.8820, lng: 125.3020,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },
  { name: '吉大和平校区',       lat: 43.8930, lng: 125.2800,
    schoolName: '吉林大学',      schoolShort: '吉大', radiusKm: 2.0 },

  // ── 东北师范大学（2 个校区，全部 2km，校内邮箱） ──
  { name: '东北师范本部(自由)', lat: 43.8600, lng: 125.3200,
    schoolName: '东北师范大学',  schoolShort: '东师', radiusKm: 2.0 },
  { name: '东北师范净月校区',   lat: 43.8000, lng: 125.4400,
    schoolName: '东北师范大学',  schoolShort: '东师', radiusKm: 2.0 },

  // ── 吉林外国语大学（校内邮箱） ──
  { name: '吉林外国语大学',     lat: 43.8187, lng: 125.3110,
    schoolName: '吉林外国语大学',schoolShort: '吉外', radiusKm: 1.15 },

  // ── 长春大学（任意邮箱 — 无官方学生邮箱后缀） ──
  { name: '长春大学本部',       lat: 43.8400, lng: 125.3400,
    schoolName: '长春大学',      schoolShort: '长大', radiusKm: 1.0 },
  { name: '长春大学林园校区',   lat: 43.8600, lng: 125.3300,
    schoolName: '长春大学',      schoolShort: '长大', radiusKm: 0.65 },
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
  | { valid: false; message: string }
  | { valid: true; location: string; requiresSchoolEmail: boolean } {

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
      }
    }
  }

  // 未在任何校区内，返回最近校区作为提示
  if (nearestCampus && nearestDist <= 10) {
    return {
      valid: false,
      message: `你当前不在任何校区附近。最近的 ${nearestCampus.name} 距离 ${(nearestDist).toFixed(1)}km，请到校园内再试`,
    }
  }

  return {
    valid: false,
    message: 'GPS 定位显示您不在长春高校区域内，无法使用此平台',
  }
}
