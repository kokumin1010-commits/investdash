# 外部来源记录

## 数据与行情接口

新环境继续使用 Manus Data API 中的 Yahoo Finance 接口：`YahooFinance/get_stock_chart` 获取价格、成交量、区间和分红/拆股事件；`YahooFinance/get_stock_profile` 获取企业名称、行业、业务摘要和公司资料。项目调用入口为 `server/_core/dataApi.ts`，业务封装为 `server/services/marketData.ts`。

2026-08-25 实测 Data API 返回账户 `usage exhausted` 后，[Yahoo Finance 公共 chart 端点](https://query1.finance.yahoo.com/v8/finance/chart/7203.T?range=5d&interval=1d&events=div%2Csplits) 仍能返回 Toyota 的真实价格、前收、52 周区间与市场时间；[Yahoo Finance 公共 search 端点](https://query1.finance.yahoo.com/v1/finance/search?q=7203.T&quotesCount=1&newsCount=0&listsCount=0) 能返回正式名称、sector 与 industry。因此新环境实现 Data API 优先、公共 chart/search 自动回退和 15 分钟额度熔断。全量手动更新实测成功更新 167 条持仓/观察记录，失败 0 条，并取得 USD/JPY 159.284、SGD/JPY 125.31、HKD/JPY 20.3207。

运行时通过 `portfolio.lookup(7203.T)` 复核得到 Toyota Motor Corporation、价格 3078 JPY、sector `Consumer Cyclical`、industry `Auto Manufacturers`。公共 search 不提供官网和完整业务摘要，因此 Data API 额度不足期间 `website` 与 `businessSummary` 明确为 `null`；已有数据库中的旧值不会被空值覆盖，新增标的仅先保存名称、行业和价格，完整字段会在 Data API 恢复后由企业资料补全任务写入。

观察列表正式名称的交叉核对参考了 [Yahoo Finance NXPI](https://finance.yahoo.com/quote/NXPI/)、[Yahoo Finance CRM](https://finance.yahoo.com/quote/CRM/) 与 [Credo 投资者关系页面](https://investors.credosemi.com/overview/default.aspx)。观察理由、目标价和买入条件仍以 GitHub 仓库内脚本为唯一业务来源。

## 模型服务状态

2026-08-25 从新项目的 `/v1/models` 实测模型目录仍包含 `gemini-3-flash-preview`、`gemini-3.1-pro-preview`、GPT-5 系列和 Claude 4.x 系列，说明模型 ID 未下线。最小成本 `gpt-5-nano` 单次探测仍返回 HTTP 412，消息为账户 `usage exhausted`；新闻 RSS 本身可用，Toyota 单标的实测保存了 14 条真实新闻，但 AI 分析暂不可执行。项目因此保留未分析新闻，并在额度恢复后自动重试，而不是丢弃新闻或伪造分析结果。

## 旧站点恢复规则

旧网址的统一维护页属于 2026 年 8 月数据分离后的待恢复状态。官方恢复入口为 [Backup & Restoration](https://manus.im/backup)，官方说明为 [How to Restore Your Data](https://help.manus.im/en/articles/16147895-service-change-overview-how-to-restore-your-data)。没有任务数据备份时，旧数据库、上传文件、平台配置与运行历史无法从源码仓库原样恢复，因此本项目采用新全栈实例与 GitHub 可重建数据重建。
