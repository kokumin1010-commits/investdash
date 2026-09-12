# 月度截图自动现金收入验证记录

## 2026-09-13 本地真实识别验证

使用清晰的富途香港测试截图，通过正式同款多模态服务进行**单次**结构化提取，没有写入数据库。模型`gemini-3.1-pro-preview`返回0条持仓、1条现金宝和1条已结算股息：

| 类型 | 识别结果 | 缺失处理 |
|---|---|---|
| 现金宝 | 易方達(香港)美元貨幣市場基金、USD 145,500、年率3.4%、日息USD 8.70、累计USD 900、基准日2026-09-13 | 没有反推字段 |
| 实际股息 | TXN／Texas Instruments、2026-09-10、净入金USD 84 | 税前额、税和手续费在截图未显示，均保持`null` |

系统以正式开发数据库中2026-08-24的同账户、同商品、同币种真实累计值USD 697.62作为前次基线，复核页显示前次截图以来实际利息 **USD 202.38**。最新日次利息USD 8.70只作为最新一天信息，不与累计差额重复相加。

## 双视口检查

同一次识别结果先在390×844检查，再切换到1280×900检查，避免为双视口重复调用模型。两个视口均满足`scrollWidth <= clientWidth`，没有横向溢出、`NaN`或`undefined`。移动端字段纵向排列，商品名、币种、基准日、当前余额、年率、日息、当前／前次累计和差额可读；桌面端现金宝和股息分别成卡，净额专用股息明确显示“ネット入金のみ取得”。

验收脚本没有点击“保存する”，报告中的`applied=false`；因此没有新增、修改现金收入、持仓或现金宝真实数据。本地截图证据：

- `/tmp/investdash-screenshot-cash-income-review-390.png`
- `/tmp/investdash-screenshot-cash-income-review-1280.png`

## SalesDash正式验收

Railway正式版本`5b380d9`于2026-09-13上线，`/healthz`返回`ok=true`和完整提交SHA。SalesDash正式Dashboard在390px与1280px均显示“スクショから自動計算”主入口；“手入力”只作为截图无法识别时的异常兜底，实际／预测分层、日期与防重复说明继续保持。

正式`/import`入口完成390×844和1280×900只读检查。页面明确说明每月截图会读取保有銘柄、现金宝实际利息和入金済み股息；提示现金宝以同商品前回截图累计值计算差额，配当只接受“入金済み／受渡済み”实际金额，并明确排除预测配当。两个视口均满足`scrollWidth <= clientWidth`，无横向溢出。

正式验收没有上传任何图片、没有创建导入任务，也没有点击保存；报告为`uploaded=false`、`applied=false`。正式入口截图证据：

- `/tmp/investdash-screenshot-cash-income-entry-390.png`
- `/tmp/investdash-screenshot-cash-income-entry-1280.png`
- `/tmp/investdash-cash-income-card-390.png`
- `/tmp/investdash-cash-income-card-1280.png`

验收后再次只读查询正式API，`import.history`仍为0件；本年记录分收入仍为¥8,222.708131、入金済み股息状态仍为`UNAVAILABLE`、最新日次利息仍为¥8,222.708131。由此确认本次正式检查没有新增导入任务或改写实际收入。
