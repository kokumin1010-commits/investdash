# Railway MySQL 自动备份与恢复手册

## 当前状态

2026-08-25 已在 Railway 的 **MySQL → Backups** 页面完成核验。打开 **Edit schedule** 后，Daily、Weekly、Monthly 三个复选框均显示为已勾选；本次没有修改并重新保存计划。页面显示下一次备份将在约 21 小时后执行，并已有一个可恢复的生产快照。

| 项目 | 当前状态 |
|---|---|
| Daily | 已启用；每 24 小时一次，保留 6 天 |
| Weekly | 已启用；每 7 天一次，保留 1 个月 |
| Monthly | 已启用；每 30 天一次，保留 3 个月 |
| 已有恢复点 | `2026-08-25 19:45` |
| 快照大小 | `1.62 GB` |
| 覆盖范围 | MySQL volume 全量内容，包括 `railway`（InvestDash）与 `salesdash` 两个 database |
| PITR / 时间点恢复 | MySQL 当前不提供；仅有离散的 volume backup 恢复点 |

> Railway MySQL 是实时数据库；Volume 负责持久化；Backups 才是历史副本。三者不是同一概念。

## 恢复步骤

在 Railway 项目中打开 **MySQL → Backups**，按时间选择目标快照并点击 **Restore**。Railway 会创建一个基于该快照的新 volume，并把变更放入 staged changes。先核对新 volume 的时间和挂载路径，再点击 **Deploy** 完成切换。

恢复过程中，旧 volume 会被保留但解除挂载。确认新 volume 数据无误后，再决定是否保留旧 volume。不要直接删除或 wipe 当前 MySQL volume，因为 Railway 官方文档明确说明：**wipe volume 会同时删除其 Railway backups**。

## 重要限制

Railway 原生 volume backup 只能恢复到同一个 project 和 environment。恢复某个旧快照还会移除比它更新的备份。自动备份适合误删和短中期回滚，但不等同于跨平台、永久归档。

Railway 的官方 PITR 文档明确针对 **Postgres**，依赖 WAL 与 pgBackRest；当前 MySQL 服务的 Backups 页面也没有 PITR 开关或时间选择器。因此本项目不能恢复到两个快照之间的任意秒，只能恢复到日、周、月 volume backup 的生成时点。

如需 Railway 项目完全丢失后仍能恢复，建议后续增加每日 `mysqldump` 到独立 S3/R2 bucket，并采用至少 30–90 天保留。该异地副本应使用单独的只写凭据和加密生命周期策略。

## 验证边界

本次已验证备份计划、下一次执行时间、现有快照大小和 Restore 入口。未在生产数据库上实际执行 Restore，因为该操作会切换 volume 并重启服务；在没有隔离恢复环境的情况下执行会产生不必要的线上风险。

## 官方参考

[Railway Backups 文档](https://docs.railway.com/volumes/backups)说明了日/周/月计划、保留周期、恢复流程、容量限制，以及 wipe volume 会删除备份、只能恢复到同项目同环境等限制。

[Railway PITR 文档](https://docs.railway.com/volumes/point-in-time-recovery)说明该能力用于 Postgres 服务；这也是本手册将 MySQL 标记为“无 PITR”的依据。
