# シグナル機能の不具合調査（2026-08-15）

## ユーザー指摘

> シグナルとは？押しても意味ない、あとは未生成はどうゆうこと？

保有一覧の各カードにある「シグナル」ボタンを押しても何も起きず、
全 27 銘柄が「未生成」バッジのままだった。

## 根本原因

開発環境で `portfolio.regenerateSignal` を直接呼び出して再現した結果、以下が返っていた。

```
LLM invoke failed: 412 Precondition Failed – {"code":9,"message":"your account has hit a usage exhausted"}
```

**Manus アカウントの AI 利用枠が上限に達している**。3 枚目のスクショ取込時（前夜）に発生した
状態が継続していた。利用枠の問題はアプリ側では解消できない（ユーザーが help.manus.im へ問い合わせる必要がある）。

## アプリ側の問題点（こちらで修正すべきもの）

| 問題 | 対処 |
|---|---|
| 生の LLM エラーがそのまま返り、画面上では無反応に見えた | `server/services/aiErrors.ts` を新設し、利用枠上限・認証エラー・タイムアウトを日本語の対処法付きメッセージへ変換 |
| 全銘柄分析で 27 銘柄すべてを無駄に試行していた | 利用枠切れを検知したら残りを打ち切る（`isQuotaError`）。全滅した場合は明確なエラーを返す |
| 「シグナル」「未生成」の意味が画面のどこにも書かれていない | 用語説明を UI に追加（作業中） |
| ニュース 0 件でも分析可能だが、その旨がユーザーに伝わらない | プロンプト上は「直近のニュースは取得されていません」として価格データのみで判定可能。UI 側で案内する |

## 補足：ニュース 0 件でも分析は可能

`server/services/analysis.ts` の `newsLines` は 0 件時に
「直近のニュースは取得されていません。」というテキストを渡す設計になっており、
価格変動・取得単価からの乖離・52 週レンジ内の位置・投資カードの記載内容だけでも
シグナルは生成できる。つまりニュース未取得は分析の障害ではない。

## 検証方法（利用枠回復後に実施）

```
TOKEN=$(curl -s -X POST "http://localhost:3000/api/trpc/auth.unlock" \
  -H 'content-type: application/json' -d '{"json":{"passcode":"1010"}}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['data']['json']['token'])")

curl -s -X POST "http://localhost:3000/api/trpc/portfolio.regenerateSignal" \
  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d '{"json":{"id":1}}'
```
