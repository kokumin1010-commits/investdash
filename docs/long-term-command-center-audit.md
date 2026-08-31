# 长期低频投资司令塔：见送检证与买增排名审计

**作者：Manus AI**  
**基准时点：2026-08-31 JST**

## 审计结论

当前 InvestDash 已能生成具体行动待办，但“见送”只把 `actionQueueItems.status` 改成 `SKIPPED`，没有后续复核时间轴。现有 `consultOutcomes` 会根据建议时与判定时的两个价格，把咨询建议判为 `CORRECT / WRONG / UNCLEAR`；它不保存见送理由、过程质量、30/90/180天节点、基本面变化，也无法区分“当时判断合理但结果不利”和“当时没有纪律但碰巧结果有利”。因此不能直接复用旧的单轴对错判定。

数据库目前没有逐标的日次历史价格表，只有当下持仓价格、组合日次总额和月次持仓。若要计算见送后的最大上涨/下跌，必须从见送日起为活动检证项保存轻量日次价格观测；不能用当前价倒推历史极值。

買い増し页面当前由 `priceBandOverview` 返回 115 个计划，其中 61 个处于买增价格带：ADD_MAIN 13、ADD_SMALL 48。61 个候选中建议金额/股数字段为 **0/61**，22 个已有懸念、3 个仍有未照合事项。现有 UI 排序只依据 `ADD_MAIN → ADD_SMALL → VERIFY → REDUCE → HOLD`，同动作再按下一价格带距离；没有考虑信号冲突、企业质量、组合仓位、IBKR 杠杆或实际可买金额。[1]

正式组合价格带 overview 的股票时价合计为 ¥869,211,742.84，112 个持仓 symbol 的平均构成比 0.8929%、前十大平均 2.9472%。当前 UI 的 ADD_MAIN 前列包括 4661.T、C38U.SI、9CI.SI、C6L.SI 和 4755.T，但其中多个标的已有懸念；“排在前面”不等于“最值得优先买”。[1]

## 可复用能力

| 能力 | 当前状态 | 本轮用途 |
|---|---|---|
| 行动待办快照 | 已有当前/建议/执行后股数金额、理由、证据、期限 | 作为见送基线 |
| 多账户执行识别 | 已按 symbol 合计比较数量变化 | 判断批准建议是否执行 |
| 组合级仓位 sizing | 已考虑净资产、流动性、单股/行业上限、IBKR 风险和交易单位 | 计算每个买增候选的股数金额 |
| 价格带核验 | 已区分 concern、unknown、未照合 | 排名硬门槛和风险扣分 |
| 持仓信号 v3 | 已有 ADD/HOLD/WATCH/REDUCE/EXIT、置信度和基本面理由 | 排除价格带与基本面冲突 |
| 投资卡 | 有 conviction、核心逻辑、估值前提、风险和退出条件 | 质量与纪律证据；自由文本不伪装成精确财务分数 |
| Railway 日次调度 | 已有统一错误边界与运行日志 | 日次价格观测及到期检证 |

## 数据边界

企业质量不能仅由 AI 文案伪造一个精确分数。第一版排名只使用可验证的结构化信号：投资卡 conviction 是否存在、信号方向/置信度、当前价格带、已核验懸念、未照合项、当前/买后构成比、现金和 IBKR 主杠杆。自由文本只作为“计算依据”展示，不直接加上不可审计的护城河分数。

月度低频目标意味着首页不应显示61个“现在买”。排名默认只突出通过硬门槛、建议金额大于0的前5个，并给出“本月候补”；其余仍可在完整列表查看。重大基本面材料可打破月度冷却，单纯价格波动不重复催促。

## 决策检证的研究依据

金融决策实验显示，即使评价者完全知道投资策略、能够独立评价决策过程，随机结果仍会显著影响他们对同一决策的评价；好结果可能来自坏决策，坏结果也可能来自好决策。[2] 因此见送检证必须同时保存**当时可得信息与纪律执行**，不能等价格上涨后就自动判“见送错误”。

长期投资的专业复盘同样强调，未来收益具有不确定性，投资者能控制的是决策质量而非结果；应先记录承担什么风险、为什么承担、预期条件为何，再依据持续证据更新，而不是用短期结果追认过程。[3] 这支持本系统使用“过程质量 × 结果质量”双轴：`纪律合理/纪律需改善` 与 `结果有利/结果不利/尚不明确` 分开显示。

系统在30日只评价执行纪律与早期风险信号；90日可评价中期价格路径和新材料；180日或下一次决算后才给较完整的结果判断。任何阶段都保留 `尚待观察`，避免为了填满报表而过早判定。

伯克希尔的官方原则强调把股票视为企业所有权，以企业长期进展而非短期价格波动衡量成功；短期下跌只有在优质企业进入有吸引力价格时才构成加仓机会。[4] 其公开收购标准进一步要求持续盈利能力、较少负债、简单可理解的业务与明确价格。[5] 因此本系统不能把“跌得最多”当作最高排名，而必须先过企业质量与财务韧性门槛。

2025 年伯克希尔股东信将资本纪律概括为：理解业务、耐久优势与长期前景，重视诚信管理层，快速集中于少数高确信机会，同时维持财务韧性与流动性。[6] 这支持 InvestDash 只突出本月前5名、对 IBKR 杠杆和行业集中度强制降权，并允许现金留白，而不是为了使用现金把61个候选全部推成“买”。

## 最终买增排名原则

排名先执行硬门槛，再计算 100 分可审计分数。硬门槛包括：当前必须是 `ADD_MAIN/ADD_SMALL`；信号不得为 REDUCE/EXIT/WATCH；`needsCheck` 必须为 false；买增 sizing 必须大于0；买后单股/行业权重不得越限；IBKR 为 WARNING/DANGER 时暂停。任一失败就显示原因，不进入本月前列。

| 维度 | 权重 | 结构化依据 |
|---|---:|---|
| 企业质量与长期确定性 | 30 | 投资卡是否完整、conviction 1–5、信号置信度、材料充足度 |
| 估值与安全边际 | 25 | ADD_MAIN/ADD_SMALL、当前价在价格带的位置、目标带距离 |
| 基本面趋势 | 20 | 信号 ADD/HOLD、一致或冲突、已核验 concern/最新重要材料 |
| 组合适配 | 15 | 当前/买后构成比、行业余量、多账户集中、单股上限 |
| 流动性与杠杆 | 10 | 建议金额可执行性、现金缓冲、IBKR 主杠杆降权 |

由于当前投资卡没有结构化护城河、ROIC 和管理层评分，第一版质量分必须明确标为“现有资料质量”，不能伪装为企业真实护城河总分。以后若加入结构化财务质量数据，再升级评分版本并重算历史。

排名稳定性采用月度快照：每月第一个 JST 运用日生成 `rankingMonth`，同月仅在重大基本面新闻、决算或风险门槛变化时重排；单纯价格日波动只更新金额和安全边际，不反复通知。页面默认显示前5名，并把61个候选区分为“本月优先／条件待ち／対象外”。

## 见送复盘最终数据契约

采用三张表而不是把历史继续塞入 `actionQueueItems`。原队列行保留操作状态；`skippedActionReviews` 保存一次见送的不可变基线与总体状态；`skippedActionReviewMilestones` 保存 30/90/180 日和决算后四次独立结论；`actionSkipPriceObservations` 保存从见送日起真实观测到的日次价格。这样可以用唯一键保证重跑安全，也不会让后续信号覆盖当时证据。

| 表 | 关键唯一键 | 主要字段与语义 |
|---|---|---|
| `skippedActionReviews` | `(userId, actionQueueItemId)` | symbol/name/action/direction/currency、完整 queue snapshot JSON、baselinePrice/Quantity/Weight、decisionNote、processVersion、processQuality、processReasons、status、skippedAt/closedAt |
| `skippedActionReviewMilestones` | `(reviewId, milestoneType, eventKey)` | `DAY_30/DAY_90/DAY_180/AFTER_EARNINGS`、dueAt、status、triggerNewsId、price/return/high/low、signalAtReview、outcomeQuality、summary、evaluatedAt |
| `actionSkipPriceObservations` | `(reviewId, observedDateJst)` | 该 JST 日实际取得的 currentPrice/currency/priceUpdatedAt/observedAt；没有价格时不伪造 0，也不补写不存在的历史 |

`SKIP` 决策在同一数据库事务中完成：先以 `SELECT ... FOR UPDATE` 读取所属用户的队列行，计算合法状态；更新为 `SKIPPED`；按队列行当时已有字段建立 review；生成 30/90/180 日三个 `PENDING` milestone；若有有效 baselinePrice，则写入跳过当日观察。重复提交由唯一键返回同一 review，而不会生成两个历史。

快照 JSON 固定保存 queue id、trigger type/key/summary、source news/signal id、previous/current action、direction、rationale/evidence、当前数量/价格/金额/权重、建议股数/金额、买卖后数量/权重、priority/deadline、decision note 与时间戳。后续页面只从该快照展示“当时为什么”，绝不从已更新的 signal 或 holdings 回填历史理由。

## 双轴判定与价格路径

过程质量只使用见送当时的字段，版本固定为 `skip-process-v1`。存在未解决核验/严重风险而选择见送，或 BUY 在 IBKR/仓位上限下不可执行，属于 `DISCIPLINE_SOUND`；对 SELL/EXIT 的高优先级建议无说明直接见送，或 decision note 为空且没有任何结构化限制，标记 `DISCIPLINE_NEEDS_IMPROVEMENT`。证据不足时保留 `PROCESS_UNCLEAR`，不强行批评。

结果质量仅描述“见送后的路径是否有利”，不等同于过程对错。BUY 见送后显著上涨是 `OUTCOME_UNFAVORABLE`，显著下跌或风险实现是 `OUTCOME_FAVORABLE`；SELL/EXIT 相反；REVIEW 在新材料出现前保持 `OUTCOME_NOT_YET_CLEAR`。第一版阈值采用绝对收益带：30 日只显示数据不定性，90 日在绝对回报超过 ±10% 且观察不少于15个交易日时才可分类，180 日/决算后在超过 ±15% 或出现明确动作方向变化时分类。否则必须保持 `NOT_YET_CLEAR`。阈值和方向写入 `skip-outcome-v1`，便于未来版本升级而不改旧结论。

最大上涨/下跌只由 `actionSkipPriceObservations` 在 baseline 后逐日计算，显示“自记录开始”，不能声称是完整市场区间高低。若 baselinePrice、某日价格或交易币种不一致，相关回报为 null，并在页面明确显示资料不足。

“下次决算后”复盘复用既有 `isEarningsNews`，但必须满足新闻 `publishedAt > skippedAt` 且 `symbol` 相同。首个符合条件的新闻建立 `AFTER_EARNINGS` milestone，eventKey 为 `earnings-news-{newsId}`；同一新闻重复扫描不新增。决算 milestone 不替代 30/90/180 日，而是一次材料例外复核。

调度每天 09:20 JST 在既有 Railway scheduler 中执行两步：仅为 `OPEN` review 的 symbol 记录当日价格；随后评估到期 milestone 和新决算新闻。任务按用户隔离、单条失败不中断其他用户；通知只在 milestone 首次变为 `COMPLETED` 后按用户汇总一次，日次价格记录不发送通知。

## 排名 v1 精确计分

`buy-plan-rank-v1` 的质量分不是护城河评分，而是现有资料可信度。投资卡存在 8 分；投资卡 conviction 1–5 映射 2/5/8/11/14 分；signal confidence 映射 0–8 分，总计最多30。没有卡或信号不伪造中位分，只得到已有资料对应分数。

估值分：ADD_MAIN 20、ADD_SMALL 14，再按价格位于当前带内的相对位置增加 0–5；带上下界缺失则不加位置分。基本面趋势分：signal ADD 14、HOLD 8，confidence ≥80 加4、≥60 加2；`concernCount` 每项扣4，最多扣8。由于 WATCH/REDUCE/EXIT 已在硬门槛排除，不用负分掩盖冲突。

组合适配分以 sizing 后仓位计算：≤2% 得15，≤3% 得12，≤4% 得8，≤5% 得4，超过上限为门槛失败；处于行业阈值90%以上再扣4。流动性与杠杆分：有效可执行股数/金额得4，金额不超过可动用流动性5%再得3；IBKR SAFE 得3、CAUTION 得1、WARNING/DANGER 为门槛失败。分数最终限制在0–100。

排序依次比较 eligible、总分、ADD_MAIN 优先、估值分、较低买后仓位、symbol。`rankingMonth` 使用 JST `YYYY-MM`。第一版不新增月度排名表，而是以同月确定性输入和稳定 tie-break 得到一致结果；金额随价格更新，但排序输入不使用单日涨跌，重大材料或信号变化才会改变资格和分数。若未来要保留月度历史，再增加 versioned snapshot 表，不能回改 v1 历史。

## References

[1]: https://salesdash.buzzdrop.co.jp/investdash/buy-plans "InvestDash 正式 BuyPlans 与受保护 priceBandOverview 数据（2026-08-31）"
[2]: https://link.springer.com/article/10.1007/s11238-020-09773-1 "Good decision vs. good results: Outcome bias in the evaluation of financial agents"
[3]: https://pwlcapital.com/evaluating-investment-decisions-what-if-bad-things-happen-to-good-investors/ "Evaluating Investment Decisions: What If Bad Things Happen to Good Investors?"
[4]: https://www.berkshirehathaway.com/owners.html "Berkshire Hathaway Owner's Manual"
[5]: https://www.berkshirehathaway.com/1997ar/acq.html "Berkshire Hathaway Acquisition Criteria"
[6]: https://www.berkshirehathaway.com/letters/2025ltr.pdf "2025 Letter to Berkshire Shareholders"
