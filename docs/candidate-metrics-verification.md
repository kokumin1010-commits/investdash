# 候选财务指标与首次建仓量正式验收

**验收日期：** 2026-09-13 JST  
**正式版本：** `21d051c`  
**正式入口：** `https://salesdash.buzzdrop.co.jp/investdash/`

## 验收范围

本次仅通过 `1010` 认证读取正式数据，没有执行加入观察、删除、见送、生成候选、修改价格、批准计划或任何交易动作。验证覆盖前回 AI 候选、实际 Watchlist、Buy Plans 研究候选，以及严格未持有购买判断卡。

| 项目 | 结果 |
|---|---|
| 必须四指标 | 予想配当利回り、PER、PBR、時価総額均固定显示 |
| 数据透明性 | 显示市场基准日、会计期末、来源与指标期间 |
| 首次建仓 | 显示当前 0 股、初回股数、JPY/当地币金额、买后占比、四批计划与下一批条件 |
| 约束说明 | 展开后显示质量指标、计算口径、现金/仓位/IBKR约束及“不自动下单”说明 |
| 缺失处理 | `未取得`、`算定対象外` 与 `暫定計算不可` 分开处理；未出现 `NaN` 或 `undefined` |
| 严格门槛 | DATA_WAIT 卡只显示 `暫定計算不可` 和 `条件通過後に再計算`，不泄漏可执行数量 |
| 响应式 | 390px 与 1280px 均无横向溢出 |

## 正式真实样本

以下数值来自正式 `portfolio.candidateCardInsights` 只读响应。所有日期、口径与来源以页面显示为准，不将其解释为未来收益预测。

| Symbol | 数据质量 | 予想配当利回り | PER | PBR | 时价总额 | 建仓状态 | 初回股数 | 初回金额（JPY） | 买后占比 |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|
| TXN | COMPLETE | 2.1139% | 40.8359倍 | 15.0796倍 | 245,389,653,228 USD | PRICE_WAIT | 43 | 1,330,600.69 | 0.1863% |
| D | COMPLETE | 4.1516% | 22.2699倍 | 1.9464倍 | 56,606,290,077 USD | PRICE_WAIT | 147 | 1,336,514.05 | 0.1871% |
| 6954.T | COMPLETE | 1.8673% | 32.1343倍 | 2.8576倍 | 5,328,966,576,530 JPY | PRICE_WAIT | 100 | 527,620.00 | 0.0739% |
| INOD | COMPLETE | 0% | 41.2558倍 | 17.0782倍 | 1,829,844,686 USD | RESEARCH_ONLY | 109 | 890,596.31 | 0.1247% |

42 个正式 Watchlist／保存候选 symbol 的批量接口返回 **38 COMPLETE、3 PARTIAL、1 UNAVAILABLE**。不完整数据继续显示透明缺失状态，不以 0 或推测值填充。

## 视觉验收

390px 的 Dominion Energy 卡中，四项核心指标保持两列排列，初回 147 股、133.65 万 JPY、买后 0.19%、四批计划与下一批条件均可读；展开区域可看到 ROE、ROIC、营业利润率、FCF、净现金/负债等口径。1280px 的 TXN 研究卡中，公司名称、长期年足、四项核心指标及首次建仓区维持清晰层级；页面无横向溢出。

| 视口 | 前回 AI 候选 | 实际 Watchlist | Buy Plans 研究候选 | 严格 DATA_WAIT |
|---|---|---|---|---|
| 390 × 844 | 通过 | 通过 | 通过 | 暂定计算不可，未强制给量 |
| 1280 × 900 | 通过 | 通过 | 通过 | 暂定计算不可，未强制给量 |

截图证据：

- `/tmp/investdash-candidate-metrics-saved-ai-390.png`
- `/tmp/investdash-candidate-metrics-watchlist-390.png`
- `/tmp/investdash-candidate-metrics-research-390.png`
- `/tmp/investdash-candidate-metrics-saved-ai-1280.png`
- `/tmp/investdash-candidate-metrics-watchlist-1280.png`
- `/tmp/investdash-candidate-metrics-research-1280.png`

## 自动测试与构建

Railway 工作树完成 **146 个测试文件、1168 项测试**，TypeScript `tsc --noEmit` 与 production build 均通过。测试覆盖指标来源/日期/期间、负 PER 与未取得区分、金融与 REIT 解释、多币种、JPY 100 股单位、现金与集中度上限、IBKR 阻断、用户隔离、390px/1280px 页面展示，以及严格候选不强制显示数量。

> 本功能仅提供长期研究与仓位规划参考，不构成个别投资建议，也不会自动下单。
