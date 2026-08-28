# ウォッチリスト AI 提案与 IBKR 杠杆审计

**作者：Manus AI**  
**基准日：2026-08-29 JST**

## 生产基线

| 数据域 | 当前结果 | 结论 |
|---|---:|---|
| 观察标的 | 15 个 | 新增流程应对已有空计划记录兼容 |
| 目标价未设置 | 10/15 | 当前 UI 让用户先填，但实际多数仍无法自行决定 |
| 目标价/预算/理由/条件全部为空 | 1/15 | 数据模型已经允许“只添加标的” |
| 观察标的信号 | 0/15 | 新增后没有自动完成“现在是否买”的判断 |
| 全体杠杆 | 1.18 倍 | 被其他无借入账户的资产稀释，只适合作为参考 |
| IBKR 杠杆 | **1.82 倍** | 借入实际只在 IBKR，应作为主风险指标 |
| IBKR 借入 | **¥229,223,831** | 不能在全体卡中弱化显示 |
| IBKR 净资产 | ¥280,042,576 | 杠杆分母为 IBKR 自身净资产 |
| IBKR 证拠金余力 | ¥174,022,087 | 当前风险等级 CAUTION |
| 追証までの下落余地 | −34.2% | 应与杠杆主值放在同一警戒卡 |
| 年间利息 | −¥3,961,737 | 当前有效利率 1.73% |
| IBKR 年间配当 | ¥12,525,194 | 配当−利息 +¥8,563,458，覆盖倍数 3.16 |

## 观察标的新增链路

`watchlist` 表的 targetPrice、plannedAmount、watchReason 和 buyConditions 本来就是 nullable；`watchlist.add` 也只要求 code，服务器会验证 symbol、取得当前价格和企业 profile 后保存。因此“先添加标的”不需要改变基本 CRUD schema，当前阻力主要来自一个对话框同时展示所有计划字段。

新增后没有自动抓取 symbol 新闻、生成 WATCHLIST signal 或买入提案。现有 `reviseTarget` 会直接把 AI 目标价写入 watchlist，并把理由追加到 buyConditions；这适合用户主动“重做目标价”，不适合首次新增，因为用户还没有确认提案。

`addProposer` 已提供 BUY / WAIT / SKIP、结论、理由、日元预算、现地币种 limit price 和结论失效条件，并通过 `computeAddSizing` 限制金额，不允许依靠新增借入或突破 5% 构成比上限。`addProposals` 已保存提案历史，但没有 watchItemId、确认状态、依据快照或 confirmedAt。

## 杠杆显示链路

后端已正确按 broker 计算 IBKR 的 borrowed、netValue、leverage、margin cushion、追証下落余地、利息和配当覆盖。Dashboard 的证券账户卡也已展示全部明细；问题是页面顶部更醒目地显示“全体のレバレッジ 1.18 倍”，而 IBKR 1.82 倍埋在账户卡明细中。

全体 1.18 倍不是错误值，但回答的是“整个资产组合有多少总资产/净资产”，不能表达借入集中在 IBKR 的局部清算风险。正确层级应把 `借入はIBKRのみ` 与 1.82 倍作为主警戒，1.18 倍只作为对照参考。

## 修复原则

观察标的先保存真实 symbol，再异步取得价格、企业资料、新闻和 AI 提案。AI 结果保存为 DRAFT，不直接改写用户的目标价、预算、理由或买付条件；用户确认时可接受、修改、拒绝或稍后处理。目标价必须显示当前价差、数据时间、依据和置信度，并明确为研究提案而非事实。

杠杆 UI 不改变计算公式，只改变信息层级：IBKR 账户风险为主，全体杠杆为参考。严重度继续由真实追証余地和证拠金余力判定，不因“想增强危机感”而夸大等级。

## 实施设计

### 新增→提案→确认状态机

新增对话框只要求銘柄コード。用户执行查询后确认名称、市场与当前价，点击 `この銘柄を追加`；服务器先保存计划字段为空的 watch item，成功后对话框进入 `データ取得中`，再独立调用 AI 提案。这样 AI 超时或失败也不会丢失用户刚添加的标的。

提案状态使用 addProposals 的扩展字段持久化：watchItemId、reviewStatus（PENDING/ACCEPTED/EDITED/REJECTED）、confidence、buyConditions、evidenceJson、confirmedAt。AI 生成前没有提案记录时为 NOT_STARTED；生成失败由 aiRunLogs 记录，watchlist 卡显示 `AI提案を作る` 重试入口。

AI 继续使用 Gemini 3 Flash 的严格 JSON schema，输出 BUY/WAIT/SKIP、结论、理由、日元预算、现地币种目标买付价、买付条件、结论失效条件和 confidence。预算仍由 `computeAddSizing` 的现金原资与 5% 构成比上限约束；未持有标的的 holdingValue 为 0，禁止以新增借入为前提。

evidenceJson 保存提案时当前价与时间、6 个月价格范围、近 12 月配当、企业资料、已分析新闻数量/时间、投资卡可用性和模型。目标价显示相对当前价差与 `AI提案・要確認`，不称为公允价值或保证价格。

确认页允许四种动作：`提案を採用して保存` 原样写入；用户修改任一字段后 `修正して保存` 并标记 EDITED；`あとで確認` 保留 PENDING 且不写 watchlist 计划字段；`提案を見送る` 标记 REJECTED。只有确认接口可以把目标价、预算、理由和买付条件写入 watchlist；生成接口绝不自动改写。

页面重载后，watchlist.list 返回每个标的最新 pendingProposal。空计划卡显示 `AI提案待ち/要確認/生成失敗`，已确认卡继续使用原有目标距离和信号。已持有标的继续区分为“买い増し”，不会显示为未持有新规买入。

### IBKR 杠杆风险层级

Dashboard 顶部把借入风险拆成独立主卡 `借入リスク（IBKR）`。主值为 IBKR 1.82 倍，并在同一视觉区显示 `借入はIBKRのみ`、借入 ¥229,223,831、净资产 ¥280,042,576、证拠金余力 ¥174,022,087、追証まで −34.2%、年间利息 −¥3,961,737 和真实 CAUTION 标签。

全体 1.18 倍降为 `全体レバレッジ（参考）`，只作为跨账户净资产对照。证券账户卡仍保留 IBKR 配当−利息与 3.16 倍覆盖信息，避免顶部警戒卡过密。颜色由现有 marginRiskLevel 决定；CAUTION 使用琥珀，WARNING/DANGER 才升级为红色。

实现不把 broker 名称硬编码进公式。后端从 brokers 中选择 borrowedBase 最大的有借入口账户作为 primaryLeveragedBroker；当前生产只有 ibkr，因此 UI 显示 IBKR。若未来其他账户也有借入，页面会显示借入口账户数，并逐账户列出，不能继续写“IBKRのみ”。

## Sources

数据来自 Railway 生产 `watchlist.list` 与 `portfolio.overview`，通过 1010 Bearer 会话读取。AI 提案与杠杆算法依据项目中的 `addProposer.ts`、`addProposalService.ts`、`portfolio.ts` 和 `leverage.ts`。
