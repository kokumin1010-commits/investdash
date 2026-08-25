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
