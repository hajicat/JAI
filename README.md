# 吉动盲盒 - 吉林动画学院盲盒交友平台

> 吉林动画学院专属盲盒交友平台，基于心理学兼容性测试，每周为你匹配一位灵魂契合的吉动人。

## ✨ 功能特性

- 🎁 **盲盒匹配** - 每周日 20:00 自动匹配一位高契合度的同学
- 📝 **深度问卷** - 5 大心理维度（安全联结、互动模式、意义系统、生活节律、情绪气象），20 道题
- 📨 **邀请码制** - 只有拿到邀请码的人才能注册，保证校内圈子
- 🔐 **加密存储** - 联系方式 AES 加密，只有双方确认后才互相可见
- 💯 **契合度评分** - 每次匹配显示百分比契合度 + 匹配原因
- 🆓 **完全免费** - 校内平台，不收任何费用

## 🛠️ 技术栈

- **前端**: Next.js 14 (App Router) + Tailwind CSS
- **后端**: Next.js API Routes
- **数据库**: SQLite (better-sqlite3)
- **认证**: JWT + Cookie
- **加密**: AES 加密存储联系方式
- **部署**: 支持 Vercel 一键部署（免费）

## 📦 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

### 3. 打开浏览器

访问 http://localhost:3000

### 4. 首次使用

1. 启动后会自动初始化数据库，创建管理员账号
2. 查看终端日志获取管理员邀请码
3. 用邀请码注册 → 完成问卷 → 成为管理员
4. 在管理后台生成更多邀请码分发给同学

## 🚀 部署到 Vercel（免费）

### 方式一：命令行

```bash
npm install -g vercel
vercel login
vercel
```

按提示操作即可。

### 方式二：GitHub + Vercel Dashboard

1. 把代码推到 GitHub
2. 去 [vercel.com](https://vercel.com) 导入项目
3. 自动部署完成

### 部署后注意

- Vercel 每次重启会重置 SQLite 数据（用 Vercel Postgres 或 PlanetScale 替代可持久化）
- 生产环境建议设置环境变量 `JWT_SECRET` 和 `ENCRYPT_SECRET`

## 📁 项目结构

```
jlai-dating/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 首页（倒计时 + 介绍）
│   │   ├── login/page.tsx        # 登录/注册页
│   │   ├── survey/page.tsx       # 问卷页（20题）
│   │   ├── match/page.tsx        # 匹配结果页
│   │   ├── admin/page.tsx        # 管理后台
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── register/     # 注册
│   │       │   ├── login/        # 登录
│   │       │   └── me/           # 用户信息 + 更新联系方式
│   │       ├── survey/           # 提交问卷
│   │       ├── match/            # 获取匹配 + 交换联系方式
│   │       ├── invite/           # 查看邀请码
│   │       └── admin/
│   │           ├── users/        # 用户列表
│   │           ├── codes/        # 邀请码管理
│   │           └── match/        # 执行匹配算法
│   ├── lib/
│   │   ├── db.ts                 # 数据库初始化 + 建表
│   │   ├── auth.ts               # JWT 认证工具
│   │   └── crypto.ts             # AES 加解密
│   └── components/               # 公共组件
├── data/                         # SQLite 数据库文件
├── package.json
├── tailwind.config.js
├── next.config.js
└── tsconfig.json
```

## 🔑 邀请码系统

1. 管理员注册时自动获得 10 个邀请码
2. 每个邀请码只能用 1 次
3. 新用户注册后自动获得 3 个邀请码
4. 形成信任链：管理员 → 第一批用户 → 他们的朋友 → ...

## 🔒 安全设计

- 联系方式（微信/QQ）使用 AES 加密存储
- 匹配前双方只看到匿名资料（昵称 + 契合度）
- 双方都点击"愿意交换"后才能看到联系方式
- JWT 认证，HttpOnly Cookie
- 不收集手机号、真实姓名等敏感信息

## 📝 自定义

### 修改学校名称

搜索 `吉林动画学院` 和 `吉动` 替换为你的学校名称。

### 修改匹配时间

在 `src/app/api/admin/match/route.ts` 中修改匹配逻辑。

### 修改问卷内容

在 `src/app/survey/page.tsx` 中修改 `QUESTIONS` 数组。

### 修改邀请码数量

在 `src/app/api/auth/register/route.ts` 中修改 `for (let i = 0; i < 3; i++)` 的数字。

## 📄 License

MIT
