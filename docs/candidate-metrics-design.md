# 未保有候補・必須財務指標設計

更新日: 2026-09-13

## ユーザー要件

候補カードでは、**予想配当利回り、PER、PBR、時価総額**を必ず固定表示する。取得できない値は推測せず「未取得」と表示する。さらに、長期保有判断に重要な収益性、キャッシュ創出力、財務余力、成長、配当持続性を展開表示し、初回購入株数・金額・買付後構成比・分割条件も併記する。

## データソース調査

| ソース | 実測／資料 | 結論 |
|---|---|---|
| YahooFinance `get_stock_profile` | Manus Data API documentation, 2026-09-13取得 | ドキュメント上は `summaryDetail`・`price` を含み得るが、実測レスポンスは `summaryProfile` のみ。sector/industry/profile用途に限定する |
| YahooFinance `get_stock_chart` | Manus Data API documentation, 2026-09-13取得 | 価格、通貨、52週高安、時系列に使用。PER/PBR等の財務指標は含まない |
| Yahoo public quoteSummary | `https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}` | crumb無しでは401 `Invalid Crumb`。そのまま本番依存にしない |
| Yahoo public fundamentals-timeseries | `query2.finance.yahoo.com/ws/fundamentals-timeseries/...`、2026-09-13実測 | crumb無しで米国株・日本株の年次財務と日次比率が取得できた。TXN、D、6954.TでPER、時価総額、EPS、株主資本、FCF等を確認。返却されたfield/date/currencyだけを採用し、欠損fieldは未取得にする |
| 既存 InvestDash | `server/services/marketData.ts`, `shared/portfolioPositionSizing.ts` | 価格・配当・sector・現金・集中度・IBKRリスク・取引単位を再利用する |

Yahoo fundamentals-timeseries の実測では、TXNは2026-09-11時点の `trailingPeRatio` と `trailingMarketCap`、2025-12-31期の `annualDilutedEPS`・`annualFreeCashFlow`・`annualStockholdersEquity`・`annualTotalDebt` を返した。6954.Tも2026-09-11時点のPER・時価総額と2026-03-31期の年次財務を返し、日本株の最低限のカバレッジを確認できた。一方、要求しても返らないfieldがあるため、実レスポンスを唯一の可用性判定とする。

## 正式環境の読み取り専用監査

2026-09-13にSalesDash正式APIを1010認証後、read-onlyで監査した。Watchlistは17件（実未保有16・既保有1）、保存AI候補28件、未保有研究候補25件、価格帯行115件、厳格未保有購入判断3件、`今すぐ購入`相当0件だった。Watchlist、保存AI候補、研究候補はいずれもsector/industryと価格を持つが、配当利回り・PER・PBR・時価総額・sizingの構造化fieldは0件だった。追加・見送り・優先度変更などのwrite操作は実行していない。

## 表示契約

### 常時表示（取得不能でも枠を残す）

1. 予想配当利回り
2. PER（実績／予想のbasisを明記）
3. PBR
4. 時価総額（通貨を保持し、表示のみ短縮）
5. 初回購入株数・金額
6. 買付後構成比

### 詳細表示

- ROE / ROIC
- 営業利益率
- Free Cash Flow と FCF yield
- 現金、有利子負債、Net cash / Net debt
- 売上成長、EPS成長
- 配当性向、配当成長
- 指標の基準日・会計期間・source/basis

## 正規化データ契約

各値は数値だけでなく、必ず次のメタデータを持つ。

| field | 意味 |
|---|---|
| `status` | `AVAILABLE` / `NOT_MEANINGFUL` / `UNAVAILABLE` |
| `value` | `AVAILABLE` のときだけ有限数。0を欠損値の代用にしない |
| `asOfDate` | 市場指標は価格基準日、財務指標は対象会計期末 |
| `period` | `TTM`、`FY2025`など。取得値に存在する期間だけを表示 |
| `basis` | 直接取得か計算値か、計算式、予想か実績かを短く明記 |
| `source` | 実際に使ったsource。fallback時も本当に使ったsourceを表示 |

`NOT_MEANINGFUL` は分母が0以下のPER、自己資本が0以下のPBR、業種上通常企業と同じ解釈をしない指標に用いる。API error、欠損、期間不一致は `UNAVAILABLE` とし、両者を混同しない。

## 指標の算定順序

| 指標 | 第一選択 | fallback / 計算 | 表示上の注意 |
|---|---|---|---|
| 予想配当利回り | Yahoo配当履歴の直近12か月継続配当 ÷ 現在値 | 特別配当検出時は継続配当を使用 | 「直近12か月継続を今後も維持する仮定」。会社予想・市場予想ではない |
| PER | Yahoo `trailingPeRatio` | 最新希薄化EPSが0以下なら `算定対象外`。正のEPSでもdirect ratioが無ければ推測しない | `実績TTM` と市場基準日を表示 |
| PBR | `trailingMarketCap` ÷ 最新年次 `StockholdersEquity` | 自己資本0以下は `算定対象外` | 市場日と会計期末を両方表示し、計算値と明記 |
| 時価総額 | Yahoo `trailingMarketCap` | fallbackなし | 通貨を保持し、表示のみ短縮 |
| ROE | 最新年次純利益 ÷ 期首期末平均株主資本 | 2期の株主資本が無ければ未取得 | 金融で重要、一般会社でも補助指標 |
| ROIC | 税引後営業利益 ÷ 期首期末平均投下資本 | 税率は同年度の税金÷税前利益 | 金融・REITでは算定対象外 |
| 営業利益率 | 最新年次営業利益 ÷ 売上高 | 売上高0以下は算定対象外 | 金融・REITでは通常企業との横比較を避ける |
| FCF / FCF yield | Yahoo年次FCF、FCF ÷ 時価総額 | 期間・通貨が一致するときだけ算定 | 金融・REITでは通常企業と同じ品質判定に使わない |
| Net cash / debt | 現金同等物・短期投資 − 有利子負債 | `NetDebt` direct値があれば整合確認 | 金融は預金・貸出構造が異なるため通常表示を抑制 |
| 売上・EPS成長 | 最新年次 ÷ 前年次 − 1 | 2期が無ければ未取得 | EPS前年が0以下なら算定対象外 |
| 配当性向 | 配当支払額 ÷ 純利益 | 純利益0以下は算定対象外 | company forecastではなく実績年次 |

## キャッシュと更新方式

財務指標は銘柄ごとに外部アクセスせず、`candidateFinancialSnapshots` の独立共有cacheへ保存する。keyは正規化symbol、payloadにはnormalized fields、source、価格基準日、会計期末、取得時刻、errorを保持する。候補・Watchlist業務表へ値を複製しない。

画面は最大60銘柄を1回のtRPCで要求する。fresh snapshotは即時返し、期限切れだけをserver側で同時実行4件に制限して更新する。1銘柄の失敗で全カードを落とさない。正常snapshotは24時間、失敗snapshotは30分後に再試行し、cardごとのAPI callは行わない。

## 共通カード出力

共有responseは `symbol`、`financials`、`sizing`、`industryLens` を返す。`sizing` は既存 `computePortfolioPositionSizing` を唯一の計算源とし、次の表示値を整理する。

| field | 表示 |
|---|---|
| `currentQuantity` | 全口座合計。未保有は明示的に0株 |
| `recommendedShares` / `recommendedAmountLocal` / `recommendedAmountBase` | `status=BUY` のときだけ行動候補として表示 |
| `afterQuantity` / `afterWeightPct` | 初回購入後の状態 |
| `trancheLabel` | 初回25% / 主力50%など既存 `tranchePct` から表示 |
| `nextTrancheCondition` | 次の価格帯・決算/資料確認条件。情報が無ければ未設定と表示 |
| `constraints` | 現金性資産、単一銘柄上限、sector上限、最低売買単位、IBKR riskを既存reasonsから表示 |

厳格判定が `DATA_WAIT` の候補は、sizing engineが数字を算出できても主表示を「暫定計算不可」にする。研究段階の参考額を出す場合も「条件通過前・発注不可」と分離し、`BUY_NOW` のhard gateを弱めない。

## 業種別の注意

| 業種 | 優先指標 | 注意 |
|---|---|---|
| 一般事業会社 | PER、ROIC、営業利益率、FCF、Net debt | PBRだけで割安判断しない |
| 銀行・保険 | PBR、ROE、資本健全性 | 通常企業のNet debtやFCFを機械適用しない |
| REIT | 配当利回り、P/NAV、FFO/AFFO | PER・営業CFだけで判断しない |
| 赤字成長企業 | 売上成長、粗利、FCF、資金余力 | 負のPERは「未取得」ではなく「算定対象外」と区別する |

## Sizing契約

既存の `portfolioPositionSizing` を唯一の計算源とし、全口座合計0株、現価格、FX、取引単位、純資産、現金性資産、単一銘柄・sector上限、IBKR集中借入を入力する。入力不足時は0株を推奨せず「暫定計算不可」とする。候補カードは注文を実行せず、分析提案として表示する。

## Phase 1監査結論

`priceBandOverview` はBuy Plansで既に全行へ `portfolioPositionSizing` を付与している。Watchlist `list`、保存候補、研究候補にはsizingが無い。したがって財務snapshotの共通batch serviceと、Watchlist/候補向けの共通sizing assemblerを追加し、Buy Plansでは既存sizingを再利用するのが最小差分である。UIは `CandidateMetricsAndSizing` を1つだけ作り、四つのcard面で同じmissing/source/date表現を使う。

## 参考資料

- Manus YahooFinance Data API documentation: `YahooFinance/get_stock_profile`
- Manus YahooFinance Data API documentation: `YahooFinance/get_stock_chart`
- InvestDash `server/services/marketData.ts`
- InvestDash `shared/portfolioPositionSizing.ts`

This is research and analysis only, not personalized financial advice.
