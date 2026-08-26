# Railway InvestDash 崩溃事故记录（2026-08-27）

**作者：Manus AI**  
**影响服务：** `investdash-production.up.railway.app` 与 SalesDash `/investdash` 代理  
**恢复提交：** `9fd16fa378049d0c8b6e91c559bc38a2ca209efb`

## 事故结论

用户在 Railway 控制台发现 `investdash` 最新部署状态为 **CRASHED**。事故确认时，公开 `/investdash` 请求超时且 Railway 直连健康端点无响应。推送恢复提交后，Railway 重新启动服务；直连与公开代理均恢复 HTTP 200，1010 解锁、112 个去重标的、156 条账户持仓、112 张投资卡和持久调度记录全部可读，未发现 MySQL 或 Volume 数据损失。

Railway 控制台的完整平台退出堆栈未能通过自动化浏览器读取，因此不能把单一异常名称写成已证明的唯一根因。代码审计发现一个与“服务运行数小时后在定时点退出”一致的进程级风险：所有 `node-cron` 回调都使用裸 `void asyncTask()`。价格、新闻和补全任务虽然有内部业务错误处理，但外层只有 `try/finally` 的路径仍会重新抛出，例如 `listAllUserIds()` 在进入逐用户 catch 前失败时，会形成未捕获 Promise rejection。

## 修复

新增 `runRailwayScheduledTaskSafely(label, task)` 作为所有 cron 入口的统一错误边界。日本/美国行情、每日新闻批次和每 20 分钟数据补全都通过该边界执行；同步或异步异常会记录为 `[Railway scheduler] ... failed outside task boundary`，但 Promise 不再向进程顶层传播。任务自身的互斥锁、逐用户错误处理、持久 `schedulerRunLogs` 和下一轮重试逻辑保持不变。

新增回归测试构造数据库瞬时断开错误，断言 cron 安全包装函数返回 resolved、输出带任务名称的错误日志且不抛出 rejection。Railway 调度测试由 9 项增至 10 项；类型检查与生产构建通过。

修复后重新执行全仓库验证：104 个测试文件、971 项测试全部通过，TypeScript 类型检查和生产构建通过。

## 生产时间线与证据

| UTC 时间 | 观察结果 |
|---|---|
| 16:13:48 | Railway 直连与公开代理均无响应 |
| 16:14:35 | 公开 `/investdash/healthz` 返回 200，版本为 `9fd16fa...` |
| 16:14:51 | Railway 直连与公开代理同时返回 200 |
| 16:15 后 | 1010 解锁成功；112 groups、156 positions、112 cards、调度记录均可读 |
| 16:20:00 | 新实例实际触发每 20 分钟自动补全巡检 |
| 16:20:26 | 直连与公开代理继续返回 200；四个已完成补全任务写入 SKIPPED、processed 0、remaining 0 |

随后再次读取直连与公开 `/healthz`，两者仍返回版本 `9fd16fa...`；公开 `/investdash/` 返回 HTTP 200 和 368,326 字节 SPA HTML。

16:20 UTC 的真实定时触发证明修复后的 HTTP 进程可在 cron 运行后继续存活。生产验证期间曾出现一次本地 DNS 解析 `salesdash.buzzdrop.co.jp` 失败，下一次请求恢复；Railway 直连始终为 200，因此该短暂 DNS 波动与本次进程崩溃分开记录。

## 后续观察

运用履历页会继续保存各任务状态；调度错误边界日志保留 task label，便于下一次在 Railway Deploy Logs 中直接定位。若再次出现 CRASHED，应优先检查 Railway 的退出码、内存曲线与最后一条 `failed outside task boundary`，区分应用异常、OOM 和平台重启，不应仅点击 Restart 后忽略原因。
