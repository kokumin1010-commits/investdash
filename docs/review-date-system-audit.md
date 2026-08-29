# 次回確認日・リマインド設計監査

**作者：Manus AI**  
**基準日：2026-08-29 JST**

## 外部日程データの確認

Yahoo Finance の公式ヘルプは、Events Calendar で銘柄別の Earnings Date を検索できると説明しており、実際の Earnings Calendar も日別の発表予定銘柄を公開している。[1] [2] ただし Yahoo は公式の公開 API を提供しておらず、一般に利用される JSON エンドポイントは非公式で、レート制限や仕様変更の保証がない。[3] 実測でも `quoteSummary?modules=calendarEvents` は日本株・米国株サンプルとも `calendarEvents=null` となったため、これを唯一の本番データ源にはできない。

JPX の公式「決算発表予定日」は、上場会社から連絡された発表予定に基づく Excel を公開し、対象期末の翌月上旬から随時更新する。掲載外の会社が発表する場合や、後日予定変更があることも公式に注意喚起されている。[4] J-Quants API は「決算発表予定日」を提供データに含め、配当の決定・予想、基準日、権利落ち日、支払開始予定日も提供する。[5] 一方、JPX の日次 CSV/API サービスには料金・プラン区分があり、全データを無条件に無料利用できるわけではない。[6]

| 方式 | 利点 | 制約 | コスト | 初期複雑度 |
|---|---|---|---|---|
| 既存信号の `validUntil` と明記された日付を使う | すぐ実装でき、112銘柄を完全にカバー | 決算確定日ではなく AI 目安の場合がある | 追加費用なし | 低 |
| JPX/Yahoo 等の外部日程を定期取得する | 会社発表に近い確認日を表示できる | 市場別カバレッジ、仕様変更、プラン・利用条件がある | 無料公開分〜有料 | 中〜高 |

本実装は両者を併用する。まず全銘柄に `validUntil` を **AI目安** として表示し、review trigger 内に明示された年月日だけを **AI記載日** として抽出する。公式データを取得できた場合だけ **会社/取引所予定** に昇格し、取れない場合は「日程未発表」として決算日を捏造しない。決算ニュースの事後検知は既存フローとして維持する。

## 現行システム・本番データ監査

`holdingSignals` には `reviewTriggers`、`validUntil`、`schemaVersion` と生成時点の価格・損益スナップショットがあるが、日付の出所や通知済みウィンドウを保持する列はない。`validUntil` が無い場合も freshness 判定は生成から 7 日後を期限として扱う。Dashboard は現在、選択したシグナルの上位銘柄に `次の確認: reviewTriggers[0]` と表示するだけで、日付・残り日数・超過状態・今週一覧はない。

2026-08-29 JST の生产 112 信号はすべて 2026-09-05 前後を `validUntil` としており、未来 7 日内 112、期限超過 0。review trigger に年月表現があるのは 3 件だけで、そのうち「2026年12月期」「2026年9月末まで」は決算発表日の確定日ではなく、対象会計期間の表現である。したがって trigger 内の年月を機械的に決算日へ変換してはならない。

Railway の既存 scheduler は価格、ニュース、配当、信号更新を UTC cron で実行し、`schedulerRunLogs` に成功・失败・明细を記録する。所有者通知 API もあるが、次回確認 reminder の job と送达去重はまだない。既存 production 方式を保つため、Manus Heartbeat を二重追加せず、Railway 日次 job に idempotent reminder stage を追加し、実行履歴と各日付/窗口の送达键を持続化する。

## 最終ルール

| dateConfidence | 表示 | 使用条件 |
|---|---|---|
| `CONFIRMED` | 確定日 | 会社が確定として公表し、変更がないと確認できた日付 |
| `SCHEDULED` | 予定日 | 会社・取引所・公式データ提供元の発表予定日 |
| `AI_ESTIMATE` | AI目安 | 信号の `validUntil`。決算予定日とは表示しない |
| `UNANNOUNCED` | 日程未発表 | 信頼できる日付が取得できず、`validUntil` もない |

現段階の production は外部公式日程を持続化していないため、112 銘柄すべてを `validUntil` に基づく **AI目安** として扱う。review trigger に「2026年9月末まで」等があっても、それは会計期間・確認条件であり、発表日には昇格しない。

JST のカレンダー日で、8 日以上前は `予定あり`、7〜2 日前は `まもなく確認`、前日・当日は `確認タイミング`、翌日〜3 日後は `結果を確認`、4 日以上経過は `確認期限超過`、日付なしは `日程未発表` とする。前チェックは通期見通し・利益・配当・価格条件など review trigger の具体項目を提示し、後チェックは実績と従来想定の差、ガイダンス変更、配当・資本政策、AI 主判断の再分析を提示する。

Dashboard の「今週確認する銘柄」は、期限超過、結果確認、当日、まもなくの順に並べ、同順位では `EXIT / REDUCE / WATCH / ADD / HOLD`、次に評価額で優先する。保有一覧は短い日付バッジ、詳細は日付・残り日数・before/after checklist を表示する。

通知は既存 Railway scheduler で毎日 09:00 JST（00:00 UTC）に 1 回実行し、D-7、D0、D+1 の対象を **1 通のダイジェスト**にまとめる。112 通を個別送信しない。`schedulerRunLogs(kind=review_reminder)` の当日成功記録を幂等键として再送を防ぎ、失败は失败记录として残して再実行可能にする。決算ニュースの事後検知・臨時通知は既存フローを維持し、この日次ダイジェストと役割を分ける。

## 生产验收

Railway 正式版本 `749b8aa` 的受保护 API 返回 112/112 个信号的 `reviewPlan`；当前 112 个均以 2026-09-05 前后的信号有效期显示为 `AI_ESTIMATE / あと7日で確認`，明确不是公司决算日。2733.T 显示 2026/9/5（土）、前置检查为“2026年9月末までの四半期決算で純利益減少が継続した場合”，并附带价格与减配条件及事后再分析清单。

390px Dashboard 截图中，“今週確認する銘柄”以 5 个优先标的加“ほか107銘柄”折叠呈现，避免把 112 行全部展开；每行显示“あと7日で確認 / AI目安”，页面宽度与 clientWidth 均为 390。390px 2733.T 详情截图中，日期、倒计时、AI目安、“この前後に確認”、确认前/后清单均完整可读，无横向截断。

1280px 保有一覧的自动断言通过，实际行动下方正确显示“あと7日で確認 / AI目安”，内部表格使用横向滚动且页面本身没有横向溢出。不过 AI 列原有 `min-width: 110px` 会把“継続保有”在窄桌面视口截断，因此最终版将该列加宽后重新验收。

最终生产版本 `f08edf3` 已将 AI 列加宽并重新验收。1280px 截图水平定位到 AI 列后，三组多账户汇总行的 `HOLD 継続保有 / あと7日で確認 / AI目安` 均完整可见；操作列仍可见，页面 scrollWidth 与 clientWidth 同为 1265。三页面自动验收全部通过：390px Dashboard、1280px 保有一覧、390px 2733.T 详情均无缺失文案或页面级横向溢出。最终本地回归为 **128 个测试文件、1047 项全部通过**，TypeScript 与生产构建通过。

## References

[1]: https://help.yahoo.com/kb/SLN5802.html "Yahoo Finance Help: Access Market Events Calendar"
[2]: https://finance.yahoo.com/calendar/earnings/ "Yahoo Finance Earnings Calendar"
[3]: https://scrapfly.io/blog/posts/guide-to-yahoo-finance-api "Yahoo Finance API: How to Get Yahoo Finance Data in Python (2026)"
[4]: https://www.jpx.co.jp/listing/event-schedules/financial-announcement/ "JPX 決算発表予定日"
[5]: https://www.jpx.co.jp/markets/other-data-services/j-quants-api/ "JPX J-Quants API 提供データ例"
[6]: https://www.jpx.co.jp/corporate/news/news-releases/6020/20240520-01.html "JPX 決算発表予定日情報提供サービス"
