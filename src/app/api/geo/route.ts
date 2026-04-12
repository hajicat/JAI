import { NextRequest, NextResponse } from 'next/server'
import { CAMPUS_LAT, CAMPUS_LNG, CAMPUS_RADIUS_KM } from '@/lib/db'
import { haversineDistance } from '@/lib/geo'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken } from '@/lib/csrf'

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // CSRF 校验（GPS 验证虽然是读操作，但由用户浏览器主动触发）
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'geo')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '请求太频繁' }, { status: 429 })
    }

    const { latitude, longitude } = await req.json()

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json({ error: '坐标格式错误' }, { status: 400 })
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: '坐标范围无效' }, { status: 400 })
    }

    const distance = haversineDistance(latitude, longitude, CAMPUS_LAT, CAMPUS_LNG)
    const withinRange = distance <= CAMPUS_RADIUS_KM

    return NextResponse.json({
      withinRange,
      distance: Math.round(distance * 100) / 100,
      campusName: '吉林动画学院',
      radiusKm: CAMPUS_RADIUS_KM,
    })
  } catch (error: any) {
    console.error('[geo]', error?.message || error)
    return NextResponse.json({ error: '定位验证失败' }, { status: 500 })
  }
}

export async function GET() {
  // 坐标精度降低到小数点后2位（约±1.1km），防止被用于伪造精确 GPS 位置
  return NextResponse.json({
    campusName: '吉林动画学院',
    campusAddress: '长春市高新技术产业开发区博识路168号',
    centerLat: Math.round(CAMPUS_LAT * 100) / 100,
    centerLng: Math.round(CAMPUS_LNG * 100) / 100,
    radiusKm: CAMPUS_RADIUS_KM,
  })
}
