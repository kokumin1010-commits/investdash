# 投资卡、价格带核验与调度日志审计

## 生产基线（2026-08-26）

通过 Railway 生产地址 `https://salesdash.buzzdrop.co.jp/investdash/` 的真实 1010 会话读取 `portfolio.overview` 与 `portfolio.priceBandOverview`，按去重持仓 symbol 统计如下。

| 数据域 | 当前生产结果 | 说明 |
|---|---:|---|
| 去重持仓 | 112 | 与仪表盘、信号、价格带覆盖口径一致 |
| 投资卡记录 | 0/112 | `groups[].hasCard` 全部为 false，尚未生成任何卡 |
| 价格带计划 | 112/112 | 上一轮已完成全部真实计划 |
| 当前价格带仍有未照合项的标的 | 51/112 | `rows[].needsCheck=true`；其余 61 个当前无待核验项 |
| 已发现懸念的标的 | 0 | 尚未批量核验，不表示没有风险 |

## 投资卡现状

`investmentCards` 以 `userId + symbol` 查询，但数据库只有普通索引，没有唯一约束。卡片字段包括 buyReason、coreThesis、valuationAssumption、fairValue、keyFinancials、exitConditions、risks、horizon、conviction。现有 `draftCardForSymbol` 会读取真实持仓、企业资料、价格、52 周区间、配当和最近新闻，使用结构化 AI 输出下稿，并明确不让 AI 生成 fairValue。

现有批量入口 `draftMissingCards(limit)` 只按市值取前 N 个空卡，返回 processed/created/failed/remaining。它不会覆盖已有非空卡，但缺少失败冷却、quota 立即中断、详细失败原因、可见覆盖状态和 Railway 自动续跑。生产目前 112 张都缺失。

## 价格带确认项现状

`runChecksForBand` 已能对单个当前价格带执行核验：只允许当前价格确实位于该 band，读取最多 20 条真实新闻，逐个输出 CLEAR/CONCERN/UNKNOWN，并保存 finding 与 sourceCount。相同 bandId + checkItem 会先删除旧结果再写入新结果，避免新旧判断混读。

当前缺口是只有单 band 手动 mutation，没有“仅处理当前仍待核验标的”的批次接口，也没有失败冷却、quota 中断与 remaining 进度。`bandCheckResults` 只保存来源件数，未保存实际新闻标题、URL、来源与发布时间，管理页无法追溯 AI 使用了哪些证据。

## 调度运行记录现状

Railway 使用常驻 `node-cron`，价格、新闻和数据补全均有互斥。当前仅在内存保存最近一次 data backfill 状态；服务重启后丢失，而且价格、新闻、资料、信号、计划、投资卡与价格带核验没有统一的持久运行记录。`aiRunLogs` 记录逐次 AI 调用的 kind/symbol/model/status/duration/detail，适合单项审计，但没有 batch run ID、任务级开始/结束、触发来源、processed/succeeded/failed/skipped/remaining 与结构化错误清单。

## 修复原则

投资卡只补实质为空的 symbol，不覆盖已有或用户修改内容；按组合市值优先，小批串行，记录失败冷却与 quota 中断。价格带只核验“当前所在 band 且仍有未保存 checkItem”的标的，不核验非当前价格带；每项保存可追溯新闻证据。调度管理页读取持久任务运行表而非进程内存，并明确区分 scheduled、manual、startup 等触发来源。

## 实施设计

新增 `schedulerRunLogs` 表，按一次任务运行保存 userId、kind、trigger、status、startedAt、finishedAt、processed、succeeded、failed、skipped、remaining、detailJson 与 errorMessage。status 使用 RUNNING/SUCCESS/PARTIAL/FAILED/SKIPPED，trigger 使用 SCHEDULED/MANUAL/STARTUP。AI 的逐标的结果仍由 `aiRunLogs` 保存，任务表只保存批次汇总和失败 symbol，避免重复存储长文本。

投资卡批次按去重持仓与日元市值排序，只选择 `isCardEmpty=true` 的 symbol。默认每轮 2 张，读取 `card_draft` 最近一次日志；24 小时内最近状态为 FAILED 的标的自动冷却，手动 `retryFailed=true` 时可重试。任何卡片已有实质内容即跳过，保证不覆盖用户内容；quota 错误立即结束本轮，返回 quotaExhausted、remaining 和 deferred。

价格带核验批次从全量计划中只选择“当前价格在 band 内、当前 band 有 checkItems、仍有未保存 item”的去重 symbol。默认每轮 2 个标的，使用 `band_check` 最新失败日志做 6 小时冷却；quota 错误立即结束。单 band 服务增加 missingOnly 模式，批量任务只把未保存 item 送给 AI，手动页面仍可重新核验全部 item。

`bandCheckResults` 增加 `sources` JSON，保存实际作为输入证据的新闻标题、URL、来源与发布时间；若 AI 返回 sourceCount 大于 0，则根据 finding 与标题/摘要的规范化关键词重叠选择最多 sourceCount 条，无法精确匹配时保存本次候选新闻并标记为候选证据，而不是伪造精确引用。

实际实现进一步提高了证据准确度：结构化 AI 输出直接返回输入新闻的 1 始まり序号 `sourceIndexes`，服务只接受列表范围内的去重序号，并按序号保存标题、URL、来源与发布时间。因此不会用关键词相似度冒充精确引用；无来源时严格保存空数组。

Railway 调度以同一互斥锁串行执行资料补全、信号、价格带、投资卡与价格带核验。顺序为先新闻/价格已有任务，再卡片与核验；在新闻窗口不运行。每个子任务写独立 schedulerRunLogs，管理页可按任务、状态、触发来源和日期筛选，并显示 processed/succeeded/failed/remaining、耗时、失败原因和详情。

## Railway 生产结果（2026-08-26 JST）

部署提交为 `b1e1a05`，运用履历状态优化为 `f0c128f`。Railway 启动时成功执行 `0025_cultured_karma.sql`（价格带证据 JSON）和 `0026_premium_maestro.sql`（持久任务运行记录表）。

| 数据域 | 生产结果 | 证据 |
|---|---:|---|
| 投资卡 | 112/112 | `overview.groups[].hasCard` 全部 true |
| 投资卡 AI 运行 | 112 成功、0 失败 | Gemini 3 Flash，平均 6,705ms，112 个去重 symbol |
| 待核验价格带 | 51/51 标的完成 | 17 个小批次、每批 3 个、0 失败、remaining 0 |
| 核验项目 | 125 项完成 | `priceBandOverview` 的 needsCheck 0、pendingCheckCount 合计 0 |
| 核验结果 | 125 项 UNKNOWN | 生产新闻仅有 16 条且全部属于 Toyota；系统未将无新闻误判为 CLEAR |
| 持久运行记录 | 上线回填后 45 条手动成功记录 | 投资卡 28 批、价格带核验 17 批 |
| 自动巡检 | 20:00 UTC 实际运行 | 资料、信号、计划、投资卡、价格带核验均 remaining 0，并正确记录为 SKIPPED |

价格带本轮“核验完成”表示系统已逐项检查现有新闻证据，不表示风险已经排除。因为 51 个标的均无对应生产新闻，结果保留 UNKNOWN、sourceCount 0 和 sources 空数组。只有后续新闻调度取得对应 symbol 的真实新闻时，重新核验才可能得到 CLEAR 或 CONCERN；页面明确说明“安全を意味しない”。

## 生产界面验收

公开路径 `https://salesdash.buzzdrop.co.jp/investdash/operations` 已使用 1010 会话验收。1280px 桌面显示 50+ 条记录、七列运行表格和四个筛选器；390×844 手机显示统计卡、四个筛选器、任务卡片和可展开详情，页面 scrollWidth 为 390，无横向溢出。手机抽屉中的“運用履歴”可见且 active=true。

持仓列表和标的详情也进行了直接生产验收，而不只依赖 API。桌面与 390×844 视口中的持仓页均显示 `投資カード 112/112` 且按钮已禁用；NVDA 详情显示真实 `5 / 6 項目 記入済み`、五个有内容的投资卡文本字段以及保留为空的 fair value。fair value 没有足够数据时不自动填写，避免把无法验证的估值当作事实。

NVDA 当前价格带的两个检查项均直接渲染 `情報不足`、JST 核验时间、`根拠ニュース 0 件` 和“判断材料が未取得です。安全を意味しません。”，并保留“確認をやり直す”入口。390px 详情页原先因五个标签横向撑开产生 461px document scrollWidth，已通过局部可滚动 Tabs 容器修复为 390px；桌面保持 1265px 内容宽度。最终全量验证为 104 个测试文件、970 项测试全部通过，TypeScript 与生产构建通过。
