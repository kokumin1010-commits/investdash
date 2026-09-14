# 顶部全市场股票搜索验证

## 本地API验证

以真实 `V03` 输入调用 `portfolio.lookup`，系统返回 `V03.SI / Venture Corporation Limited / SGD / SES`，不再把裸代码作为不存在的美国代码。以 `Venture` 调用顶部多候选搜索时，区域化Yahoo搜索把 `V03.SI` 放在同名美股与其他海外候选之前。

## 自动化覆盖

纯函数与服务测试覆盖 `V03 / 5DD / DCRU / 7203 / 005930 / 2330.TW` 的候选和市场识别。路由测试覆盖认证用户隔离、已持有优先于已观察、V03安全保存为完整 `V03.SI`。组件测试覆盖390px／1280px、搜索提交、未登记添加、已持有跳转和已观察聚焦。

## 视觉检查

本地开发环境在390px与1280px执行只读UI验收。两种视口均通过：顶部搜索存在；裸 `V03` 与公司名 `Venture` 都返回 `V03.SI`；显示公司名、新加坡市场、SGD当前价和明确的Watchlist动作；页面没有横向溢出，也没有 `NaN / undefined`。

移动端采用单列结果卡，名称、代码、市场和动作完整显示；桌面端采用信息与动作横向排列。为固定移动页头增加 `scroll-mt-20`，结果展开或重新定位时不会把输入框遮在页头下方。

验收脚本没有点击“ウォッチリストに追加”，因此没有创建或修改任何正式／本地Watchlist数据。

| 视口 | 结果 | 横向溢出 | 截图 |
|---:|---|---|---|
| 390px | 通过 | 无（390/390） | `/tmp/investdash-global-stock-search-390.png` |
| 1280px | 通过 | 无（1265/1265） | `/tmp/investdash-global-stock-search-1280.png` |

## SalesDash正式环境

Railway功能提交 `5cd1861` 于2026-09-14部署到SalesDash正式入口。正式环境以1010认证执行只读验证：`V03` 与 `Venture` 都把 `V03.SI / Venture Corporation Limited` 放在首项，显示“シンガポール株”、SGD价格与日期；390px和1280px均无横向溢出，输入框在固定页头下保持可见。验收脚本未点击添加按钮，`writePerformed=false`。
