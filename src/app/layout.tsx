import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '吉动盲盒 | 吉林动画学院盲盒交友',
  description: '吉林动画学院专属盲盒交友平台，每周为你匹配一位灵魂契合的吉动人',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  )
}
