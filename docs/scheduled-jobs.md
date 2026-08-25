# InvestDash 定时任务注册清单

定时任务使用平台托管的 HTTP 回调，不依赖浏览器、沙箱常驻进程或应用内计时器。所有 cron 均为 **六字段 UTC**；下表同时列出实际使用的日本时间。回调必须在新站点发布后注册，因为平台只会调用生产地址。

| 工作内容 | 日本时间 | UTC cron | 回调路径 | 数量 |
|---|---:|---|---|---:|
| 日本市场收盘后行情更新 | 平日 15:30 | `0 30 6 * * 1-5` | `/api/scheduled/syncPrices` | 1 |
| 美国市场收盘后行情更新 | 平日 06:30 | `0 30 21 * * 1-5` | `/api/scheduled/syncPrices` | 1 |
| 每日新闻抓取与 AI 分析 | 每日 07:00–08:30 | 从 `0 0 22 * * *` 起每三分钟一批 | `/api/scheduled/syncNews/0` 至 `/api/scheduled/syncNews/30` | 31 |

价格任务会更新全部市场的 167 条持仓与观察记录，并同步 USD/JPY、SGD/JPY、HKD/JPY。分别安排在日本和美国收盘后，是为了在用户查看时同时保持两个主要市场的数据新鲜度。

新闻任务按 **四个去重标的一批**执行。当前数据库共有 123 个持仓与观察标的，因此需要 31 批。每个批次使用固定 URL 和固定 offset，平台重试时仍处理同一范围，数据库写入保持幂等；这比在单个请求内处理全部标的更符合两分钟回调限制。

发布后，在项目目录运行以下命令注册全部 33 个任务：

```bash
bash scripts/register-heartbeats.sh
```

注册结果中的 `task_uid` 必须保存回本文件或最终恢复报告。任务可在项目管理界面的 **Settings → Schedules** 查看执行历史、暂停、恢复或手动运行。

AI 模型服务当前若返回额度不足，新闻正文仍会保存并标记为“未分析”；后续批次会明确返回 `analysisUnavailable`，不会伪造分析。额度恢复后，同一批次会自动重试既有未分析记录。

## 运维命令

```bash
manus-heartbeat list
manus-heartbeat logs --task-uid <uid>
manus-heartbeat logs --task-uid <uid> --status failed --with-body
manus-heartbeat update --task-uid <uid> --enable=false
manus-heartbeat update --task-uid <uid> --enable=true
```
