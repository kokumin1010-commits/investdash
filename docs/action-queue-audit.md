# アクション待ちリスト审计与设计基线

**基准时点：2026-08-29 JST**

## 审计结论

现有系统已经具备行动队列需要的四个核心能力，但尚未形成统一的待处理工作流。`refreshStaleSignalsBatch` 会根据 `NEW_NEWS`、价格变动、期限和 schema 变化自动再分析；`holdingActionPlan` 会以全部账户的 symbol 合计持仓确定 REDUCE/EXIT 的股数、金额和执行后仓位；组合级 priceBand sizing 会为 ADD 计算买入股数与金额；`consultOutcomes` 会在持仓导入后依据总股数变化判断建议是否实际执行。

目前这些能力分散在信号、买增提案、价格带和咨询结果中。用户无法从一个位置看到“现在有多少、建议买卖多少、操作后是多少、为什么、何时处理”，也无法统一执行“加入计划／见送／稍后／完成”。因此需要独立的 `actionQueueItems` 持久表，而不是把卖出行动强塞进只支持 BUY/WAIT/SKIP 的 `addProposals`。

## 生产基线

正式环境当前有 112 个持仓 symbol 信号，分布为 HOLD 99、REDUCE 10、WATCH 3，当前可复核行动为 13 个。按评价额排序的前五项为 ACN（REDUCE，¥18,206,883.108）、5938.T（REDUCE，¥6,858,150）、3436.T（REDUCE，¥6,181,200）、2733.T（REDUCE，¥5,476,000）和 9023.T（REDUCE，¥5,159,000）。这些现存信号可作为首次安全回填候选，但不会在迁移时自动写入或改变真实持仓。

## 自动入队边界

行动队列接入信号再分析的事务边界：在 `regenerateSignal` 取得旧信号、生成新信号并保存后，以新 signal id 作为幂等依据创建或更新队列。`refreshStaleSignalsBatch` 将 freshness reasons 传入再分析；只有 `NEW_NEWS`、用户手动再分析或明确的 action 变化才进入队列。普通期限刷新、schema 刷新或价格刷新若行动仍为 HOLD，不产生待办。

新闻/决算后的真实流程为：材料取得 → 信号标记 stale → `REANALYZING` → 保存新信号 → ADD/REDUCE/EXIT 进入 `PENDING_ACTION`；WATCH 仅在需要用户确认具体材料时进入；HOLD 或无实质变化记录为 `COMPLETED`/不显示。相同 source signal 或相同事件 key 重试时只更新原项，不重复新增。

## 执行与安全

`計画に追加` 只把队列项标为 `APPROVED`，代表用户确认这份计划，不向券商下单。`今回は見送る` 标为 `SKIPPED`；`あとで確認` 设为 `SNOOZED`；`確認済み` 标为 `COMPLETED`。持仓导入后复用多账户合计数量自动核对 APPROVED 项：BUY 数量增加、SELL/EXIT 数量减少才判为执行。

所有金额、价格、股数、当前/执行后仓位和证据在入队时保存快照，避免之后行情变化导致历史建议被悄然改写。新的材料若出现，则创建新版本或更新仍未决定的同 symbol 项；已批准、已见送或已完成的历史不覆盖。

## 数据模型要点

行动项保存 userId、symbol、name、status、triggerType/key、source/previous signal id、previous/new action、信号理由、证据、当前股数/价格/评价额/构成比、建议股数/金额、执行后股数/构成比、期限、snooze/decision/completion 时间与审计时间。以 `(userId, triggerKey)` 唯一约束保证事件重试幂等，并以 user/status/deadline 和 user/symbol/updatedAt 索引支持列表与历史。

## 最终状态机

| 状态 | 意义 | 可进入的下一状态 |
|---|---|---|
| `WAITING_MATERIAL` | 已知需等决算/材料，但结果尚未取得 | `REANALYZING`、`SKIPPED` |
| `REANALYZING` | 新材料已取得，正在生成新信号 | `PENDING_ACTION`、`COMPLETED`、`FAILED` |
| `PENDING_ACTION` | 有具体行动，等待用户判断 | `APPROVED`、`SNOOZED`、`SKIPPED`、`COMPLETED` |
| `APPROVED` | 用户已把建议加入计划，尚未确认执行 | `COMPLETED`、`SKIPPED` |
| `SNOOZED` | 延后到指定时间；到期后查询时恢复为待确认 | `PENDING_ACTION`、`APPROVED`、`SKIPPED` |
| `SKIPPED` | 用户明确本次见送，保留历史 | 终态；新材料创建新版本 |
| `COMPLETED` | 无行动、用户确认完成或持仓变化证明已执行 | 终态；新材料创建新版本 |
| `FAILED` | 再分析/快照失败，可安全重试 | `REANALYZING`、`SKIPPED` |

## 触发、去重与更新规则

`NEW_NEWS` stale reason 触发时，最新已分析新闻按 `detectUrgentEvents` 区分 `EARNINGS` 与 `IMPORTANT_NEWS`。触发 key 使用 `previousSignalId + newsId + triggerType`；同一重试只更新同一行。新信号写入后，ADD/REDUCE/EXIT 总是进入 `PENDING_ACTION`，WATCH 仅在决算或影响度达到重要新闻阈值时进入，HOLD 记录为 `COMPLETED` 且不占待办数量。

用户手动点“AI分析を実行”时，以新 signal id 为 key；行动与旧信号相同且为 HOLD 时不显示待办，行动变化或 ADD/REDUCE/EXIT/WATCH 时进入待办。常规 EXPIRED/SCHEMA/PRICE_MOVE 刷新不因刷新本身制造队列，只有行动发生实质变化才入队。

同 symbol 尚有 `REANALYZING/PENDING_ACTION/SNOOZED` 时，新事件更新该活动项的证据和新 signal 快照；已经 `APPROVED/SKIPPED/COMPLETED` 的历史不覆盖，新事件创建新版本。数据库唯一键和服务层 active-item 合并同时防止重复。

## 行动契约与优先级

队列快照以全部账户合计为准。REDUCE/EXIT 复用 `holdingActionPlan`；ADD 复用 priceBand 的组合级 sizing；WATCH 为 0 株复核。每项固定保存 `当前株数/构成比 → 建议买卖株数与日元金额 → 执行后株数/构成比`，之后行情变化不改写历史建议。

排序优先级为 EXIT 100、REDUCE 80、ADD 70、WATCH 50；决算触发 +10、期限超期 +20、48 小时内 +10，再以评价额排序。EXIT/REDUCE 的初始确认期限为 2 日，ADD/WATCH 为 3 日，首次存量整理为 7 日。期限是“确认建议”的运用期限，不是收益保证或强制交易日。

`計画に追加` 仅将状态改为 `APPROVED`，行动项本身即为可执行计划；不向券商发送订单。`今回は見送る` 为 `SKIPPED`，`あとで確認` 默认延后 3 日并可选 1/3/7 日，`確認済み` 为 `COMPLETED`。之后导入持仓时，BUY 的总株数增加或 SELL/EXIT 的总株数减少才自动完成 APPROVED 项；账户间移仓不以单账户变化误判。

## 首次上线

为让页面上线后立即有内容，使用明确标识 `INITIAL_REVIEW` 对现有 13 个 REDUCE/WATCH 信号进行一次安全回填。它们显示“既存シグナルの初回整理”，不伪装成新决算触发；HOLD 99 不进入活动队列。回填只保存建议快照，不修改持仓、价格带或交易数据。
