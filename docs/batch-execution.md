# 一括処理の分割実行（180 秒制限への対応）

## 背景

本番は Manus の Autoscale（Cloud Run 相当）で動いており、**1 リクエストの上限は 180 秒**。
開発環境（sandbox の dev server）にはこの制限がないため、ローカルで動いても
本番では途中切断されるという形で問題が出る。

実測した所要時間は次のとおり。いずれも上限を大きく超える。

| 処理 | 1 銘柄あたり | 27 銘柄合計 |
|---|---|---|
| シグナル生成（AI分析） | 10〜16 秒 | 約 5 分 |
| ニュース取得 + AI 分析 | 約 28 秒 | 約 12 分 40 秒 |

## 方式

サーバー側で `offset` から `batchSize` 件だけ処理し、続きがあれば `nextOffset` を返す。
クライアントは `nextOffset` が `null` になるまで呼び出しを繰り返す。
1 リクエストの時間を制限内に抑えつつ、ユーザーから見れば 1 回のボタン操作で完走する。

```
client                          server
  │  offset=0  ──────────────▶  6 銘柄処理
  │  ◀──── nextOffset=6, processed=6, total=27
  │  offset=6  ──────────────▶  6 銘柄処理
  │  ◀──── nextOffset=12 ...
  │  offset=24 ──────────────▶  3 銘柄処理
  │  ◀──── nextOffset=null   ← 完了
```

### batchSize の決め方

1 バッチが 180 秒に収まる範囲で、往復回数が少なくなる値を選ぶ。

| 処理 | batchSize | 最悪ケース | 余裕 |
|---|---|---|---|
| シグナル生成 | 6 | 6 × 16 = 96 秒 | 47% |
| ニュース取得 | 4 | 4 × 28 = 112 秒 | 38% |

## 実装箇所

| 役割 | ファイル |
|---|---|
| シグナル生成の分割 | `server/routers/portfolio.ts` の `regenerateAllSignals` |
| ニュース取得の分割 | `server/routers/newsRouter.ts` の `syncAll` / `server/services/portfolio.ts` の `syncNewsForUser` |
| クライアントの繰り返し実行 | `client/src/hooks/useBatchRun.ts` |
| 呼び出し側 | `client/src/pages/Dashboard.tsx` / `client/src/pages/News.tsx` |
| テスト | `server/services/batchSlice.test.ts` |

## 注意点

- **定期実行（Heartbeat）は分割不要。** `syncNewsForUser` は `batchSize` を省略すると
  全件処理する。`server/scheduled.ts` は省略して呼んでいるので従来どおり動く。
  Heartbeat の呼び出しは HTTP リクエストのタイムアウト制約が緩いため。
- **AI 利用枠切れは後続バッチも必ず失敗する**ので、検知した時点で打ち切る
  （`shouldStop` / `quotaExhausted`）。残りを試すのは無駄な待ち時間になる。
- **`offset` はソート順に依存する。** `db.listHoldings` の並び順が実行中に変わると
  取りこぼしが起きる。並び順を変える改修をする場合はここを見直すこと。
- Railway へ移行する場合、この制限自体は無くなるが分割実行のままで問題ない
  （進捗表示が出るので、むしろユーザー体験としては望ましい）。

## 検証結果（2026-08-16）

27 銘柄のシグナル生成を分割実行で完走させた実測値。

| バッチ | offset | 件数 | 所要 |
|---|---|---|---|
| 1 | 0 | 6 | 66.8 秒 |
| 2 | 6 | 6 | 57.4 秒 |
| 3 | 12 | 6 | 75.9 秒 |
| 4 | 18 | 6 | 75.0 秒 |
| 5 | 24 | 3 | 38.9 秒 |

合計 314 秒（5 分 14 秒）／失敗 0 件。最長バッチは 75.9 秒で、上限 180 秒に対し 42%。
ネットワーク遅延や AI 応答の揺れを考えても十分な余裕がある。

分割実行後の判定分布は ADD 4 / HOLD 13 / WATCH 10（平均確信度 53〜61）。
