# 買い増しプラン交互审计

## 已复现问题

| 编号 | 生产复现 | 根因初判 | 修复方向 |
|---|---|---|---|
| BP-01 | 直接访问 `https://salesdash.buzzdrop.co.jp/buy-plans` 返回 BuzzDrop 404 | InvestDash 只挂载于 `/investdash` | 将入口和内部导航统一到 `/investdash/buy-plans`，根路径增加兼容跳转 |
| BP-02 | 从 `/investdash/holdings` 点击侧栏“買い増しプラン”，地址变成 `/buy-plans`，主内容空白 | `DashboardLayout` 在 `WouterRouter` 外部，侧栏的 `useLocation()` 使用了根路由 | 把 Router 移到 DashboardLayout 外层，统一子路径导航 |
| BP-03 | Toyota 行同时显示 `HOLD` 与 `今も買う` | “如果未持有现在是否买”的 Buffett 判断被放在已持有列表，短标签省略了问题前提 | 已持有页面改为“新規なら買える水準”，追加购买只由价格带/买增计划表达 |
| BP-04 | Toyota 在买增计划为“様子見（現状は買い増ししない）”，持仓页却显示“今も買う” | 两个判断轴没有在 UI 中明确区分 | 为“新规判断”和“追加购买判断”加清晰标题与不同文案 |
| BP-05 | Toyota 下一段显示 `-0.0% で「小幅に買い増し検討」` | 浮点数负零未归一化 | 小于显示精度的差值改为“現在の水準”或 `0.0%` |
| BP-06 | 点击“この件を相談する”进入 `/investdash/consult`，但输入框为空，页面也没有 Toyota 标识 | 提案卡只链接 `/consult`，没有传 `symbol` 与问题文本 | 链接带 `symbol` 与 `question`，咨询页读取并预填 |
| BP-07 | 搜索无结果后只能手工删除关键字 | 空状态没有清除搜索/恢复全部计划按钮 | 在搜索空状态提供“一覧に戻す”操作 |

## 已验证正常的交互

正确入口 `/investdash/buy-plans` 可加载 AI 买增提案、四个筛选、搜索、计划卡片和判定历史。点击“すべて”能显示 Toyota 计划；点击计划卡能进入 `/investdash/holdings?symbol=7203.T` 并显示 3 个账户合计。AI 提案对 Toyota 给出的结论是“見送る”，理由为持仓占比 5.74% 超过 5% 上限，这与买增计划的“様子見”一致。

四个筛选均已实际点击：BUY、VERIFY、OUTSIDE 在计数为 0 时切换选中状态并显示对应空状态；ALL 显示 Toyota。搜索输入 `7203` 能保留 Toyota，输入 `NO-SUCH-SYMBOL` 能进入空状态。AI 生成按钮已实际点击，正确显示“直近 3 日以内に提案済み”的 toast，未重复生成。提案标题和计划卡可点击；咨询链接可导航，但未携带上下文，记录为 BP-06。

## 待完成点击矩阵

桌面端生产点击矩阵已完成。仍需在修复后重复相同矩阵，并补充 390 px 手机视口的抽屉、筛选、搜索、卡片和咨询预填验收。

## 修复后本地视觉回归

在 1440×900 与 390×844 两个视口完成生产构建页面渲染。桌面端标题、AI 提案卡、四个筛选、搜索和判定历史均在同一内容区内；手机端 AI 按钮扩展为整行，四个筛选使用 2×2 网格，搜索框单独占一行。390 px 截图未出现横向滚动或被裁切控件，文字、计数和空状态均可读。

手机抽屉另以 Chromium CDP 做了实际交互验收：从 `/holdings` 点击可见的 Sidebar trigger，确认 drawer 与“買い増しプラン”按钮可见；点击后 URL 变为 `/buy-plans`，`h1` 为“買い増しプラン”，对应导航按钮的 `data-active` 为 `true`。视口宽 390、document scrollWidth 390，没有横向溢出；抽屉开启截图显示全部导航触控区域完整。

自动化方面，新增 React Testing Library + jsdom 的真实 BuyPlans 页面渲染测试，实际点击 BUY/VERIFY/OUTSIDE/ALL 按钮，输入无结果关键字、断言空状态、点击清除按钮恢复列表，并从渲染后的提案卡读取咨询链接的 symbol/question 参数。SalesDash 代理为 4 项测试。InvestDash 全量 Vitest 共 **95 个测试文件、937 项测试，全部通过**；TypeScript 检查与生产构建也通过。

## Railway 生产回归

最终 InvestDash 版本 `1efd7646f23801b8d2bd63b7890528611d3f8691` 已上线。旧入口 `https://salesdash.buzzdrop.co.jp/buy-plans` 返回 308，并指向 `/investdash/buy-plans`。正确页面的“すべて”显示 Toyota 一条计划；“買い増し圏”计数为 0，Toyota 行写明“様子見（現状は買い増ししない）”，负零已改为“現在の水準が『小幅に買い増し検討』の目安”。

生产搜索输入 `NO-SUCH-SYMBOL` 后出现“該当する銘柄はありません”与“検索をクリアして一覧に戻す”，点击清除后 Toyota 列表恢复。“この件を相談する”实际跳转到 `/investdash/consult?symbol=7203.T&question=...`，咨询 textarea 已预填构成比 5%、见送理由和覆写条件。

持仓页 `https://salesdash.buzzdrop.co.jp/investdash/holdings?lens=BUY_NOW` 中 Toyota 的当前动作保持 **HOLD**，独立 Buffett 假设判断明确改为 **“仮に未保有なら買う”**。筛选标题、下拉选项和行内小字均使用相同措辞，不再表达“现在追加购买”。

最终 Railway 生产 390×844 回归使用真实 1010 token：从持仓页实际打开手机 drawer，`drawerVisible=true`、买增按钮可见；点击后 pathname 为 `/investdash/buy-plans`、标题为“買い増しプラン”、对应导航 `data-active=true`。viewportWidth 与 document scrollWidth 均为 390，没有横向溢出。生产截图确认抽屉所有入口、触控区域和底部解锁状态均完整可见。

同一 390 px 生产会话继续执行了完整点击矩阵：依次点击“買い増し圏 / 確認が必要 / 価格帯の外 / すべて”，前三项显示空状态、ALL 恢复 Toyota；输入 `NO-SUCH-SYMBOL` 后出现空状态与清除按钮，点击后列表恢复；AI 提案 CTA 可点击且提案可见；Toyota 计划卡跳转 `/investdash/holdings?symbol=7203.T`；返回后点击咨询链接，跳转 `/investdash/consult?symbol=7203.T&question=...`，textarea 确认已预填完整 Toyota 提案上下文。全部断言通过。
