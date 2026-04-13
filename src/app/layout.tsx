import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '吉我交 | 长春高校盲盒交友',
  description: '长春高校专属盲盒交友平台（吉林大学/东北师范/吉林动画/吉林外国语/长春大学），每周为你匹配一位灵魂契合的吉我交人',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="text-center py-6 text-gray-400 text-xs border-t border-gray-100">
          <p>🎁 吉我交 © 2026 · 长春高校 · 用心构建</p>
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
