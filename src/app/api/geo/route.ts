import { NextRequest, NextResponse } from 'next/server'
import { verifyLocation } from '@/lib/geo'
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

    const result = verifyLocation(latitude, longitude)

    if (!result.valid) {
      return NextResponse.json({
        withinRange: false,
        message: result.message,
        nearestCampus: result.nearestCampus || undefined,
        nearestDistance: result.nearestDistance || undefined,
      })
    }

    return NextResponse.json({
      withinRange: true,
      location: result.location,
      requiresSchoolEmail: result.requiresSchoolEmail,
      nearestCampus: result.nearestCampus || undefined,
      nearestDistance: result.nearestDistance || undefined,
      nearbyCampuses: result.nearbyCampuses || [],
    })
  } catch {
    return NextResponse.json({ error: '定位验证失败' }, { status: 500 })
  }
}

export async function GET() {
  // 返回所有校区列表（精度降低到小数点后2位）
  return NextResponse.json({
    campusName: '长春高校圈',
    campusAddress: '长春市（吉林大学/东北师范大学/吉林动画学院/吉林外国语大学/长春大学）',
    schools: [
      '吉林动画学院',
      '吉林大学',
      '东北师范大学',
      '吉林外国语大学',
      '长春大学',
    ],
    campusCount: 13,
  })
}
