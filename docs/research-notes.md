# データソース調査メモ（2026-08-14）

## 株価データ：YahooFinance Data API（内蔵）

`callDataApi("YahooFinance/get_stock_chart", { query: {...} })` が日本株・米国株の両方で動作確認済み。

| 銘柄 | シンボル | 結果 |
|---|---|---|
| SUBARU | `7270.T` | regularMarketPrice 2557.5 JPY / JPX / longName "Subaru Corporation" |
| 東京地下鉄 | `9023.T` | 1456.0 JPY（longName は null、shortName にフォールバック必要） |
| モルフォ | `3653.T` | 683.0 JPY |
| Apple | `AAPL` | 303.47 USD / NMS |

`chart.result[0].meta` から取得できる主要フィールド：`currency` `symbol` `exchangeName`
`fullExchangeName` `regularMarketPrice` `regularMarketTime` `fiftyTwoWeekHigh`
`fiftyTwoWeekLow` `regularMarketDayHigh` `regularMarketDayLow` `regularMarketVolume`
`longName` `shortName` `chartPreviousClose` `timezone`。
時系列は `timestamp[]` と `indicators.quote[0].{open,high,low,close,volume}`。

**注意**：日本株シンボルは 4桁コード + `.T` サフィックス。region は `US` のままでも
正しく解決されるため、サフィックスで市場を判定する方針とする。

## 業種・企業概要：YahooFinance get_stock_profile

レスポンス構造は `quoteSummary.result[0].summaryProfile`（README のサンプルとは異なるため
実レスポンスに合わせて実装する）。日本株でも `sector` / `industry` / `country` /
`website` / `longBusinessSummary` が英語で取得できる。

| 銘柄 | sector | industry |
|---|---|---|
| 7270.T | Consumer Cyclical | Auto Manufacturers |
| 9023.T | Industrials | Railroads |
| AAPL | Technology | Consumer Electronics |

セクター名は英語で返るため、UI 表示用に日本語マッピング辞書を用意する。

## ニュース：Google News RSS

`https://news.google.com/rss/search?q=<query> when:30d&hl=ja&gl=JP&ceid=JP:ja` が
良好に動作。日本株の決算ニュースが日経・株探・Car Watch 等から十分な件数取得できた。
クエリは「銘柄名 + 決算」「銘柄名 + コード」の組み合わせが有効。米国株は
`hl=en-US&gl=US&ceid=US:en` を使う。RSS の `<item>` から title / link / pubDate /
source を抽出する。

`YahooFinance/get_stock_insights` の `sigDevs` も補助的に使えるが 1 件のみで
日本株の鮮度が低い場合がある（例：3653.T は 2018 年の記事）。主軸は RSS とする。

## AI 分析：内蔵 LLM

`invokeLLM` を `server/_core/llm.ts` から利用。OCR には vision 対応が必要なため
`gemini-3-flash-preview`（長コンテキスト・マルチモーダル・低コスト）を第一候補、
ニュースのセンチメント判定は `gpt-5-mini`、シグナル生成の統合推論は
`claude-sonnet-4-6` を使う。JSON Schema 構造化出力（`strict: true` +
`additionalProperties: false`）を必須とする。

## 免責

本アプリは情報整理・分析支援ツールであり、投資助言ではない旨を UI 上に常時表示する。
