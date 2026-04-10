# MEMORY.md - 吉动盲盒项目长期记忆

## 项目基本信息
- **项目名**：吉动盲盒（jlai-dating）
- **描述**：吉林动画学院盲盒交友网站
- **路径**：`c:\Users\zhuxiaoyun\Desktop\jlai-dating\jlai-dating`
- **框架**：Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **数据库**：@libsql/client（本地文件 SQLite / Turso 云端）

## 技术决策

### 数据库选型（2026-04-09）
- 原来用 `better-sqlite3` → 无法在 Windows（缺 Visual Studio）或 Vercel 无服务器函数中运行
- 改为 `@libsql/client`：纯 JS，本地用 `file:./data/xxx.db`，生产用 Turso 云端
- 通过环境变量 `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` 区分本地/生产

## 管理员信息
- 邮箱：`admin@jlai.local`
- 首次启动自动生成随机密码，查看终端日志获取
- **⚠️ 上线后请立即修改管理员密码！**

## 部署方式
- **Vercel**（免费 Hobby Plan）
- **必须环境变量**：JWT_SECRET、ENCRYPT_SECRET、TURSO_DATABASE_URL、TURSO_AUTH_TOKEN
- 详细步骤见 `DEPLOY.md`

## 已修复的 Bug
1. login API 缺少 `surveyCompleted` 字段
2. `@import` 在 `@tailwind` 之后（CSS 顺序错误）
3. 缺少 `@keyframes float` 定义
4. better-sqlite3 原生模块编译失败
