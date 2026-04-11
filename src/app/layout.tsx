import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '吉动盲盒 | 吉林动画学院盲盒交友',
  description: '吉林动画学院专属盲盒交友平台，每周为你匹配一位灵魂契合的吉动人',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="text-center py-6 text-gray-400 text-xs border-t border-gray-100">
          <p>🎁 吉动盲盒 © 2026 吉林动画学院 · 用心构建</p>
          <p className="mt-1">
            有问题或建议？联系邮箱：
            <a href="mailto:zhu96223@gmail.com" className="text-pink-500 hover:text-pink-600 hover:underline transition">
              zhu96223@gmail.com
            </a>
          </p>
        </footer>
      </body>
    </html>
  )
}
