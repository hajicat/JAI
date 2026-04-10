import { NextResponse } from 'next/server'

export const runtime = 'edge';

export async function POST() {
  const response = NextResponse.json({ success: true })

  // Clear both possible cookie names (with and without __Host- prefix)
  for (const name of ['token', '__Host-token', 'csrf-token']) {
    response.cookies.set(name, '', {
      httpOnly: name !== 'csrf-token',
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }

  return response
}
