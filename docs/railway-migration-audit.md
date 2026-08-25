# Railway / SalesDash 迁移审计

## 目标项目

| 项目 | 值 |
|---|---|
| Railway 项目 | `sales-dash` |
| 项目 URL | https://railway.com/project/5248baa0-4810-4a83-b0c4-cdd63bef47bb |
| Environment | `production` (`98535196-be26-4ea9-9ec0-6cf58461d70c`) |
| 主服务 | `main-sales-management-system` |
| Service ID | `9bfc639c-fc53-4fa8-9697-dc1f578e3223` |
| GitHub 仓库 | `kokumin1010-commits/main-sales-management-system` |
| 部署分支 | `main`，开启 GitHub 自动部署 |
| Builder | Dockerfile，配置来自 `/railway.toml` |
| Healthcheck | `/healthz`，超时 300 秒 |
| Restart policy | `ALWAYS` |
| Serverless | 未启用，服务常驻 |
| 主域名 | https://salesdash.buzzdrop.co.jp |
| 目标路径 | https://salesdash.buzzdrop.co.jp/investdash |

## 现有路由状态

2026-08-25 访问 `https://salesdash.buzzdrop.co.jp/investdash` 返回 BuzzDrop 的标准 404 页面，因此该路径当前没有业务占用，可以用于 InvestDash。SalesDash 前端使用 React 19、Wouter、Vite、Express、tRPC 与 Drizzle；主应用在 `client/src/App.tsx` 中集中处理公开路径、全站密码门和内部路由。

## 网络与运行

主服务对外监听端口 3000，已绑定 `salesdash.buzzdrop.co.jp` 和多个其他业务域名。Railway 还提供 `main-sales-management-system.railway.internal` 私网地址。项目当前只有一个主服务卡片，变量页显示 86 个 Service Variables 和 8 个 Railway 自动变量；页面仅审计变量名称与依赖类型，没有读取或记录密钥值。

变量页当前可见区主要是 Amazon、邮件和支付相关变量，Railway 架构图中也未显示数据库服务卡片。审计时没有发现可明确复用于 InvestDash 的 `DATABASE_URL` 引用，因此迁移方案应预设为在同一项目新增独立 MySQL 服务，并通过 Railway 的变量引用将其只暴露给 InvestDash 服务；不能把 SalesDash 现有业务数据库当作已确认可用资源。

## 推荐集成方式

为避免把 InvestDash 的 24 张表、920 项测试和专用 UI 直接塞进 8,500 行以上的 SalesDash 服务器入口，优先采用**同一 Railway 项目新增独立 InvestDash 服务 + SalesDash 主服务按 `/investdash` 与 `/api/investdash` 反向代理至 Railway 私网**。这样可以维持两个数据库与运行时的隔离，同时让用户继续通过 `salesdash.buzzdrop.co.jp/investdash` 访问。

若 Railway 私网代理在平台边缘对前端静态资源存在路径限制，再退回单仓库 monorepo 方案：把 InvestDash 作为 `apps/investdash` 构建，并由主 Express 服务在 `/investdash` 下挂载其静态文件与 API。该方案耦合更高，仅作为备选。

## Railway 官方约束核对

Railway 官方文档确认，同一项目与 environment 内的服务可通过 `<service>.railway.internal:PORT` 使用加密私网通信，浏览器不能直接访问该私网。因此 `salesdash.buzzdrop.co.jp` 仍由 SalesDash 主服务接收，再由服务器端代理到 InvestDash 私网服务是符合平台设计的方式。

Railway 的 custom domain 只支持把**整个域名**映射到服务的某个 target port，没有按 URL path 将同一域名分配到不同服务的原生路由规则。因此不能直接把 `/investdash` 绑定到第二个服务，必须在 SalesDash Express 中实现反向代理，或将应用物理合并到同一个服务。

Railway 原生 Cron 使用五字段 UTC crontab，最短频率为五分钟，并要求任务运行完毕后退出。如果上次仍在运行，下次会被跳过。原 Manus 方案中的三分钟新闻批次不应原样复制。鉴于目标 InvestDash 服务计划常驻运行，可以在应用内使用 `node-cron` 以固定批次游标执行日、美行情和日次新闻；若改用 Railway 原生 Cron，则需把批次间隔调整为至少五分钟并部署独立的短生命周期 worker 服务。

### 官方参考

- https://docs.railway.com/networking/private-networking
- https://docs.railway.com/networking/domains/working-with-domains
- https://docs.railway.com/cron-jobs
- https://docs.railway.com/guides/cron-workers-queues

## 已完成的兼容改造与验证

InvestDash 已支持由 `VITE_APP_BASE_PATH=/investdash/` 控制 Vite 资源路径、Wouter 路由 base 与 tRPC 基址。生产构建生成的脚本和样式均以 `/investdash/assets/...` 开头；代理剥离公开前缀后，上游根路径 `/healthz`、静态资源与 `/api/trpc` 均返回 200。浏览器端仍使用独立的 1010 パスコード，实际 `auth.unlock` 返回有效 token。

Railway 外部运行时增加了 `OPENAI_API_KEY` / `OPENAI_MODEL` 回退。当 Manus Forge 凭据不存在时，LLM 请求切换到 OpenAI Chat Completions，移除 Forge 专用 thinking/reasoning 参数；专项 Vitest 已验证 URL、Authorization、模型选择和响应解析。

SalesDash 仓库新增 `/investdash` 私网代理，目标由 `INVESTDASH_UPSTREAM_URL` 配置。代理在全局 body parser、tRPC 和 SalesDash SPA fallback 之前注册，公开路径被剥离后转发至同项目服务。两个代理测试均通过：一项验证 query string 与路径重写，另一项验证未配置上游时返回清晰 503。SalesDash 全仓 `tsc` 因既有代码规模超过 1.5GB heap 而 OOM，因此采用代理文件专项严格类型检查和 8,500 行服务器入口 esbuild 打包，两项均通过。

截图历史已增加 Railway 持久卷存储：设置 `STORAGE_LOCAL_DIR=/data/investdash-files` 并挂载 volume 后，上传文件写入持久目录，浏览器通过 `/investdash/files/...` 读取；未设置该变量时仍保留 Manus Forge S3 逻辑。专项测试验证了写入、读取、随机后缀和子路径 URL。

数据库迁移脚本会在 Railway 服务启动前执行 Drizzle 历史迁移；当前真实数据库已通过 migrate-only 模式验证“Database migrations are current”。受控导出覆盖 26 张业务表，其中 holdings 156、monthlyHoldings 156、watchlist 11、newsItems 14、portfolioSnapshots 7，文件权限为 600 并被 `.gitignore` 排除，导出脚本也已验证可正常退出。

## Railway 执行状态

2026-08-25 已在 `sales-dash / production` environment 中创建独立 MySQL 服务与 `mysql-volume`。Railway 架构视图显示服务 `Online · Initializing`；现有 `main-sales-management-system` 保持 Online，没有连接或修改该新数据库。下一步是等待 MySQL ready，再创建 GitHub `investdash/railway-migration` 服务并使用变量引用连接该数据库。

Railway 的 GitHub App 已列出 `kokumin1010-commits/investdash`，说明新服务可以直接连接已推送的 `railway-migration` 分支，无需调整仓库授权。创建服务时仍需在 Settings 中把 branch 从默认 `main` 改为 `railway-migration`，避免部署旧版本。

已创建 Railway 服务 `investdash`，Service ID 为 `de7ff767-7acd-428c-bbe7-e759bced5203`。生产来源已从默认 `main` 切换到 `railway-migration`；该变更目前与 MySQL/服务创建一起处于 Railway 的 staged changes，尚未点击 Deploy。现有 SalesDash 服务仍为 Online。

InvestDash 的 Raw Editor 已填写以下变量，等待点击 Update Variables：`DATABASE_URL` 引用 `MySQL.MYSQL_URL`；`VITE_APP_BASE_PATH=/investdash/`；`PUBLIC_BASE_PATH=/investdash`；`STORAGE_LOCAL_DIR=/data/investdash-files`；`INVESTDASH_SCHEDULER_ENABLED=false`；`OPENAI_API_KEY` 引用 `main-sales-management-system.OPENAI_API_KEY`；`OPENAI_MODEL=gpt-4.1-mini`；`NODE_ENV=production`；另有独立随机 `JWT_SECRET`。文档不保存 JWT 或任何 API 密钥值。

MySQL 已从 Initializing 转为 Online。Raw Editor 的变量已提交到 Railway staged changes；在首轮应用部署、数据库导入和页面验证完成前，`INVESTDASH_SCHEDULER_ENABLED` 保持 `false`，避免空库或迁移中途触发自动任务。

持久卷首次创建时 Railway 的服务选择结果落在 `main-sales-management-system`，生成了 `main-sales-management-system-volume`（挂载 `/data`）。该卷仍只是 staged change、没有部署或写入数据。必须先删除该错误卷，再明确选择 `investdash` 重建；在修正前不会点击 Deploy。

错误的 SalesDash 卷连接已移除，SalesDash 卡片恢复 Online 且无 staged change。随后通过服务名筛选 `investdash` 重新创建卷；架构视图现显示 `investdash-volume` 隶属于 InvestDash，服务为 `New · 3 Settings`，挂载路径 `/data`。全部变更仍未 Deploy。

六项变更已应用，首次 InvestDash deployment ID 为 `434eed77-737e-4490-9e1c-b2bca14955f5`。Railway 当前状态为 `BUILDING`，日志显示 Nixpacks 正在获取构建环境并安装依赖；界面暂时显示 `Service is offline` 是因为尚无完成的首个 deployment，不是健康检查失败。日志中的 Dockerfile `undefined-var` 为生成器规则警告，当前未导致构建中止。

Railway 实际构建计划为 Node.js 24、pnpm 10、OpenSSL；install 执行 `pnpm i --frozen-lockfile`，build 执行 `corepack enable && pnpm install --frozen-lockfile && pnpm build`，start 使用 `pnpm railway:start`。依赖安装已完成，当前进入生产 build 步骤，尚未出现应用代码错误。

首次容器启动日志确认镜像与持久卷均成功，但 `DATABASE_URL` 未进入实际 runtime，`railway-start.mjs` 因此主动退出。根因是 Raw Editor 的内容没有被 Railway 编辑器接收，页面仍显示源代码扫描产生的 Suggested Variables。现已改用建议变量表单逐项填写：`DATABASE_URL` 指向 `MySQL.MYSQL_URL`、JWT 使用独立随机值、`OPENAI_API_KEY` 指向 SalesDash 同名变量；尚未点击表单底部 Add，因此不会把占位值误部署。

Suggested Variables 表单已完成并点击 Add。Railway 现明确显示 **8 Service Variables**：`DATABASE_URL`、`INVESTDASH_SCHEDULER_ENABLED`、`JWT_SECRET`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`PUBLIC_BASE_PATH`、`STORAGE_LOCAL_DIR`、`VITE_APP_BASE_PATH`；全部以掩码显示并处于 `Edited · 8 Changes`。下一步应用这些变量以触发修复部署。

修复 deployment `f5081a2e-d46e-42f9-9437-25e0037afcb5` 已 Completed，InvestDash 服务状态为 **Online**。运行日志确认：`[Railway] Database migrations are current`、服务器监听 `localhost:8080`、调度器仍为 disabled、持久卷存储启用于 `/data/investdash-files`。OAuth 缺少 `OAUTH_SERVER_URL` 的日志不影响个人 1010 パスコード模式；Railway 版不要求 Manus OAuth。

使用 MySQL 的公共 TCP 代理执行一次受控导入。首轮在 `brokerBalances.capturedAt` 遇到 ISO 8601 字符串与 MySQL DATETIME 格式差异；导入脚本已改为根据 `SHOW COLUMNS` 类型把 ISO 时间转换为 JavaScript Date。幂等重试成功恢复 holdings 156、monthlyHoldings 156、watchlist 11、newsItems 14、portfolioSnapshots 7、interestAssets 4、brokerBalances 1、monthlySnapshots 1、passcodeAuth 1 和 users 1；导出文件与数据库凭据均未提交 Git。

独立只读核验脚本随后连接 Railway MySQL，对 users、holdings、watchlist、monthlyHoldings、monthlySnapshots、newsItems、passcodeAuth、portfolioSnapshots、interestAssets、brokerBalances 共 10 张关键表逐项执行 COUNT；全部与导出预期一致并返回 OK。

SalesDash 主分支已推送私网代理提交 `1b5b37b5`。公开健康端点 [https://salesdash.buzzdrop.co.jp/investdash/healthz](https://salesdash.buzzdrop.co.jp/investdash/healthz) 返回 `application/json` 与 `{"ok":true,"service":"investdash","version":"386cabce7e417fb72a839bc444be6659d5a332c6"}`，证明 HTTPS → SalesDash → `investdash.railway.internal:8080` 链路已接通。公开首页标题为 `InvestDash — 個人投資ダッシュボード`，脚本资源 `/investdash/assets/index-DZyplF-o.js` 返回 HTTP/2 200 和 JavaScript content-type。浏览器已显示独立 InvestDash 1010 パスコード页，不受 SalesDash 现有页面或登录流程影响。

认证诊断确定公开代理与 Railway 直连均能收到 Authorization，JWT 也有效；最初失败点是 Railway `users` 表缺少 owner 行，而 `passcodeAuth.ownerUserId=1` 已存在。依据受控导出原文恢复 users.id=1 后，直连和公开代理的 `tokenValid`、`userResolved` 均为 true，`portfolio.overview` 返回 HTTP 200 与真实 Toyota 等持仓。

调度器自动启用版本 `d1dd25ff5a3b36911a36569cd17ce3a12dbe53b4` 已上线 [Railway 直连健康端点](https://investdash-production.up.railway.app/healthz)。重部署后 users=1、holdings=156 持久存在；公开 [InvestDash](https://salesdash.buzzdrop.co.jp/investdash/) 的组合概览返回 HTTP 200。Railway 环境现在不再依赖手机端变量页面，价格任务按工作日 UTC 06:30/21:30、新闻 31 批按每日 UTC 22:00–00:30 自动运行。

生产手动任务实测：`portfolio.syncPrices` 返回 HTTP 200，更新 167 条记录、失败 0，汇率为 USD/JPY 159.298、SGD/JPY 125.372、HKD/JPY 20.3231。`news.syncOne(7203.T)` 返回 HTTP 200，新抓取 2 条、成功分析 14 条，`analysisUnavailable=false`、失败标的为空，证明 Railway 的 OpenAI 回退与新闻分析链路可用。

SalesDash 的独立 `salesdash` database 已在同一 Railway MySQL 实例创建，专用用户仅获 `salesdash.*` 权限，对 InvestDash 的 `railway` database 可见表数量为 0。数据库包含 326 张 SalesDash 表；两个 Drizzle 历史迁移已建立基线，users.role 已补齐为 `user/admin/master/member`。
