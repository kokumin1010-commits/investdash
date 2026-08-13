# 実装状況メモ

## 完了済み（バックエンド）

| ファイル | 内容 |
|---|---|
| `drizzle/schema.ts` | 9 テーブル定義済み・DB へ適用済み（holdings / investmentCards / newsItems / signals / watchlist / importJobs / portfolioSnapshots / userSettings / users） |
| `shared/investing.ts` | シグナル定義・セクター日本語辞書・シンボル正規化・金額整形・免責文 |
| `server/services/marketData.ts` | `fetchQuote` / `fetchPriceHistory` / `fetchCompanyProfile` / `fetchQuotes` / `fetchUsdJpyRate` |
| `server/services/news.ts` | Google News RSS 検索・ノイズ除去・URL ハッシュ |
| `server/services/ocr.ts` | `extractPositions`（gemini-3.1-pro-preview + JSON Schema） |
| `server/services/analysis.ts` | `analyzeNewsBatch`（gpt-5-mini）・`generateSignal` / `generateWatchSignal`（claude-sonnet-4-6） |
| `server/services/portfolio.ts` | `buildPortfolio` / `syncPrices` / `enrichProfiles` / `syncNewsForUser` / `regenerateSignal` |
| `server/db.ts` | 全テーブルのクエリヘルパー |
| `server/routers/*.ts` | portfolio / newsRouter / watchlistRouter / importRouter |

## 完了済み（フロントエンド）

デザイントークン（深い藍色基調・oklch）、フォント（IBM Plex Sans + Noto Sans JP + IBM Plex Mono）、
`DashboardLayout` のナビ日本語化、共通コンポーネント（`SignalBadge` / `Figures` / `DisclaimerNote`）、
`Dashboard.tsx`、`Holdings.tsx`。

## 残作業

`HoldingDetail.tsx`（投資カード）、`Watchlist.tsx`、`News.tsx`、`ImportScreenshot.tsx`、
`Settings.tsx`、`App.tsx` のルーティング、Heartbeat 定期ジョブ、vitest。

## 重要な技術メモ

- Yahoo Finance の profile レスポンスは `quoteSummary.result[0].summaryProfile`（README のサンプルと異なる）
- 日本株シンボルは `7270.T` 形式。`region` は `US` のままで解決される
- ニュースは Google News RSS（`when:30d` 指定）。日本株は `hl=ja&gl=JP&ceid=JP:ja`
- 利用可能 LLM: claude-haiku-4-5 / claude-opus-4-6 / claude-opus-4-7 / claude-sonnet-4-6 / gemini-3.1-pro-preview / gemini-3-flash-preview / gpt-5 / gpt-5.5 / gpt-5-mini / gpt-5-nano
- `invokeLLM` は `responseFormat` と `maxTokens` を受け付ける

## 全ページ実装完了

`Dashboard.tsx` / `Holdings.tsx` / `HoldingDetail.tsx` / `Watchlist.tsx` / `News.tsx` /
`ImportScreenshot.tsx` / `Settings.tsx` を作成し、`App.tsx` で
`SidebarProvider > DashboardLayout > Router` 構成にルーティング登録済み。型チェックは通過。

## スクリーンショット検証時の所見（デバッグ中）

スクリーンショット撮影時、ページが `DashboardLayoutSkeleton` のまま止まる事象が発生。
`/import` は 1 度だけ正常描画され、サイドバーとログインユーザー名も表示された。

- `node_modules/.vite` 削除 + サーバー再起動で `ThemeProvider` の
  `Cannot read properties of null (reading 'useState')` は再発しなくなった
- `curl /api/trpc/auth.me` は `[{"result":{"data":{"json":null}}}]` を返す（cookie 無しなので想定通り）
- 独立診断の推定: `main.tsx` の `queryClient.getQueryCache().subscribe` が
  未認証時に `startLogin()` を発火し続け、`me` クエリが解決しないまま
  loading が true で固定される可能性。スクリーンショット環境は cookie が渡らないため
  この経路に入りやすい（実ブラウザでは正常に動作する見込み）
- 対処方針: `startLogin()` の発火を 1 回だけに制限し、未認証時は
  DashboardLayout のログイン画面分岐に委ねる

## スケルトン固着の原因と解決（解決済み）

**根本原因**: `client/src/main.tsx` の Provider ネスト順が誤っていた。
テンプレート初期状態は `trpc.Provider > QueryClientProvider > App` だったが、
tRPC の hooks は React Query の `QueryClientContext` を前提に動くため、
`QueryClientProvider` を外側に置く必要がある。

```tsx
// 修正後
<QueryClientProvider client={queryClient}>
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <App />
  </trpc.Provider>
</QueryClientProvider>
```

副次的に以下も修正した。

- `main.tsx`: 未認証時の `startLogin()` を 1 度だけに制限（リダイレクトループ防止）
- `DashboardLayout.tsx`: `if (loading)` → `if (loading && !error)`（認証エラー時に固まらない）
- `vite.config.ts`: `resolve.dedupe: ["react", "react-dom"]` を追加
- `node_modules/.vite` を削除して依存を再最適化（Invalid hook call の解消）

検証結果: ダッシュボード・保有銘柄・ウォッチリスト・ニュース・設定の全ページが
正常に描画され、空状態の案内も意図通り表示されることを確認した。

## 残作業

- Heartbeat による定期ジョブ（株価・ニュース）
- vitest による単体テスト
- 実データ（ユーザーのスクリーンショット）での OCR 動作確認
