# 生产监控、新闻覆盖与保有期间审计

**作者：Manus AI**  
**审计日期：2026-08-27 JST**

## Railway 官方能力

Railway 项目级 Webhooks 会在部署状态变化或告警触发时向指定 URL 发送 JSON，事件包括 deployment 状态、Volume 使用告警和 CPU/RAM 阈值告警。官方 Webhook 配置位于 Project Settings → Webhooks，并可筛选事件。[1]

Railway Observability Dashboard 可显示 CPU、Memory、Network、Disk、Logs 和 Project Usage。CPU/RAM/Disk/Network 阈值 Monitor 可发送邮件、站内通知或 Webhook，但官方注明 Monitor 需要 Pro 计划。[2]

Railway `/healthz` 设置只用于新部署切流前的启动健康检查，不是上线后的持续监控；官方对持续监控另行推荐外部探测。[3] Restart Policy 默认是 `On Failure` 且最多重启 10 次；付费计划可设置 `Always` 和不同重启次数。[4]

| 目标 | 最可靠来源 | 当前实施方向 |
|---|---|---|
| CRASHED/部署失败即时事件 | Railway Project Webhook | 接收 Railway 事件并写入 InvestDash 事故记录；平台侧仍需一次 Webhook URL 配置 |
| CPU/RAM 真实容器阈值 | Railway Monitor | 若当前计划支持，在 Railway 仪表盘配置 RAM/CPU 阈值 Webhook；应用内存作为补充 |
| 上线后健康失败 | 应用外部探测 | 不能由 InvestDash 自己可靠判断自己已宕机，应由 SalesDash 或独立探测端检查 Railway `/healthz` |
| 最后应用日志 | 应用结构化事件环形缓冲 + Railway Deploy Logs | 应用可保存自身最近错误和调度摘要；进程被 SIGKILL/OOM 时退出码仍以 Railway 平台日志为准 |

## 新闻生产基线

通过 Railway 直连、1010 Bearer 会话读取生产 `news.list(limit=200)`：最新 200 条新闻覆盖 90 个 symbol。该接口有 200 条上限，因此这只是“最新新闻窗口覆盖率”，不能据此断言数据库历史只有 90 个 symbol。

将最新 200 条与 112 个持仓 groups 对比，有 31 个 symbol 不在该窗口：`UNH, PRU, F34.SI, ACN, MRVL, 6724.T, 8473.T, 2318.HK, 4919.T, KHC, BMY, Z74.SI, 9023.T, RIO, UPS, 9449.T, ALAB, 0823.HK, 0883.HK, 9CI.SI, 3769.T, 3778.T, 8410.T, 4927.T, C38U.SI, 7201.T, CVS, 4933.T, 4661.T, HMY, 4755.T`。需要新增数据库聚合覆盖接口并逐 symbol 检查，才能得到准确的全量覆盖和最后新闻日期。

随后对这 31 个 symbol 分别执行带 symbol 条件的生产查询：20 个在历史中已有新闻，11 个为真正的 0 条覆盖。真实缺口为 `UNH, PRU, F34.SI, ACN, 2318.HK, RIO, UPS, ALAB, 0823.HK, 0883.HK, HMY`，因此当前全量覆盖为 **101/112**，而不是 90/112。

现有链路已经按 symbol 去重 targets，并用 URL SHA-256 前 40 位做 `urlHash`；问题不在持仓账户重复，而在搜索查询命中、RSS 空结果、最新窗口/历史窗口、批次失败报告和覆盖状态不可见。Google News 查询目前为“名称 + ticker/证券代码 (+ stock) + when:30d”，每个 symbol 上限 14 条。

## 保有期间数据可用性

当前 `holdings` 没有真实首次买入日期，只有数据行 `createdAt`；生产 `overview` 也不返回 createdAt。项目没有券商真实 transaction/trade 表。`consultOutcomes.executedAt` 是咨询建议执行检测时间，不能当作首次买入日。

`monthlySnapshots` 与 `monthlyHoldings` 可证明某 symbol 在某次月次快照时已经持有；当前恢复数据只有 2026-08 月，故旧仓位最多只能显示“至少自该快照日期持有”，不能推出原始买入日。没有月次记录时只能使用导入/holding createdAt，并明确标为“系统记录开始日”，不得称为首次买入。

建议新增每账户持仓的 `acquiredAt`、`acquiredAtSource` 与 `acquiredAtConfidence`：真实券商成交或用户确认使用 `EXACT`；最早月次快照使用 `AT_LEAST`；仅导入日期使用 `TRACKED_SINCE`。symbol 层面取各账户中最早有依据日期，并显示依据和“持续持有未完全验证”的说明。未来若接入完整交易流水，再按清仓后重新买入重置持有期间。

当前恢复数据库的 156 条 holdings 均创建于 2026-08-25 04:38:27–04:42:50 UTC；2026-08 月月次快照在 2026-08-25 04:42:52 UTC 捕获，覆盖全部 112 个 symbol。因此在没有用户补录或真实成交记录前，112 个标的都只能显示“系统自 2026-08-25 起确认持有”，不能显示为精确首次买入日。

## 可实施监控方案比较

| 方案 | 取舍 | 运行成本 | 设置复杂度 |
|---|---|---:|---:|
| Railway 原生 Webhook + RAM Monitor | 能直接收到 CRASHED、deployment failed 和真实容器 RAM/CPU 阈值；Monitor 需要 Pro，Webhook URL 需在 Railway 设置一次 | Railway 计划费用内；Monitor 可能需 Pro | 中 |
| SalesDash 每分钟外部探测 + 现有 Brevo 告警邮件 | 不依赖 InvestDash 自身存活，能检测 HTTP 失败/恢复并持久保存最后响应；无法获得平台 OOM 的真实退出码 | 无新增服务费用 | 低 |
| 分层组合 | SalesDash 负责持续可用性与邮件，InvestDash 记录 Node/cgroup 内存和运行事件，Railway Webhook 补充平台 CRASHED；覆盖最完整 | 无新增应用费用，原生 RAM Monitor 视 Railway 计划 | 中 |

实施不以付费 Monitor 为前提：先完成 SalesDash 外部探测、Brevo 邮件和 InvestDash cgroup 内存/运行事件；同时提供 Railway Webhook 接收端。若用户当前 Railway 计划支持 Monitor，再把官方 RAM 阈值事件接入同一记录与邮件链路。

## 实施设计

### 外部健康与告警

SalesDash 作为独立进程，每分钟从 Railway 私网访问 InvestDash `/healthz`。连续 3 次失败后开启 incident 并发送一次 critical 邮件；恢复一次成功后关闭 incident 并发送一次 warning 恢复邮件。状态、连续失败数、HTTP 状态、延迟、版本、首次失败、最后失败、恢复时间和错误文本写入 SalesDash 独立数据库，部署重启不会丢失或重复通知。

SalesDash 同时提供 Railway Project Webhook 接收端，原样保存 event type、severity、service、deployment、commit、timestamp 和 details。只对 InvestDash 的 crashed/failed/alert 发送 critical 邮件，对 recovered/success 发送恢复邮件，并按 event/deployment ID 去重。该端点必须使用高熵 URL token 或签名校验；Railway 设置页配置前需先确认生产 endpoint 可用。

InvestDash `/healthz` 增加 uptime、版本、Node RSS/heap、cgroup current/max、使用率和最近结构化运行错误摘要。每分钟只采样内存到进程内环形缓冲；超过 80%/90% 时向持久 `systemEvents` 写 WARNING/CRITICAL，恢复到 70% 以下写 RECOVERED。SalesDash 的外部探测读取该使用率并负责邮件，因此即使 InvestDash 的通知服务不可用也不会漏掉阈值告警。退出码只在 `process.on('exit')` 或可捕获 signal 时记录；OOM SIGKILL 的真实退出码必须以 Railway Webhook/Deploy Logs 为准。

### 新闻全覆盖

新闻去重键改为 `(userId, symbol, urlHash)`。现有 `existingNewsHashes` 增加 symbol 条件，允许同一篇确实关联多个持仓的新闻分别出现在各 symbol 下，同时防止同一 symbol 重复。

每个标的依次使用最多 3 个真实查询并合并去重：公司名+ticker、ticker/证券代码+市场关键词、去后缀 symbol+stock/company news。JP/HK/SG/US 使用对应 Google News locale；只在上一查询无结果或覆盖不足时执行 fallback，限制总请求和总文章数。批处理优先 0 条 symbol，其次 14 天无新新闻的 stale symbol；返回 total/covered/missing/stale/processed/failed/nextOffset 和新增新闻的 symbols。

`newsCoverage` 按 112 个去重持仓聚合 count、latestPublishedAt、latestCreatedAt、freshness 和 query status。对真实无新闻的 symbol 显示“検索済み・該当なし”，不能用无关市场新闻填满覆盖率。

### 价格带自动复核

新增新闻写入后，只选择“当前 band 存在 UNKNOWN 结果，且该 symbol 最新 news.createdAt 晚于最新 bandCheckResults.createdAt”的标的。每轮串行 2 个，使用既有 Gemini 3 Flash 结构化核验与 sourceIndexes 证据；没有新新闻不重跑，CLEAR/CONCERN 不因定时任务被覆盖。任务写入 schedulerRunLogs 并保留 quota/失败冷却。

### 保有期间

`holdings` 新增 nullable `acquiredAt` 与 `acquiredAtSource`（USER_CONFIRMED/BROKER_TRADE）。其余来源不硬写成首次买入日期，而是运行时派生：真实字段为 EXACT；最早月次快照为 AT_LEAST；只有 holding.createdAt 时为 TRACKED_SINCE。多账户同 symbol 以最早可靠日期作为标的期间，同时返回每账户明细；若部分账户缺日期，symbol 明确降级为 AT_LEAST。

列表显示“保有期間 1年2か月”等格式、起算日期、`正確 / 少なくとも / 記録開始から` 标签和依据。详情页允许用户按账户补录或清除首次买入日；清除恢复派生口径。所有天数按 JST 日期差计算，避免 UTC 跨日少一天。

## References

[1]: https://docs.railway.com/observability/webhooks "Railway Docs — Webhooks"
[2]: https://docs.railway.com/observability "Railway Docs — Observability Dashboard"
[3]: https://docs.railway.com/deployments/healthchecks "Railway Docs — Healthchecks"
[4]: https://docs.railway.com/deployments/restart-policy "Railway Docs — Restart Policy"
