# InvestDesk


保有銘柄・投資理由・ニュースを一元管理する個人向けの投資意思決定支援ツール。証券会社アプリのスクリーンショットから保有ポジションを読み取り、関連ニュースを自動収集して AI が評価し、ADD / HOLD / WATCH / REDUCE / EXIT のシグナルを根拠つきで提示する。

> 本アプリが表示する分析・シグナルは公開情報を自動整理した情報提供であり、投資助言ではありません。最終的な投資判断は利用者自身の責任で行ってください。

## 主な機能

| 機能 | 内容 |
|---|---|
| スクリーンショット取込 | 証券会社アプリ（楽天証券 iSPEED 等）の保有一覧画像から銘柄コード・株数・取得単価・現在値を OCR で抽出し、確認・編集の上で保存する |
| 総資産ダッシュボード | 総時価評価額、総損益、業種別・通貨別の構成比、ポジション集中度アラート、資産推移 |
| 保有銘柄一覧 | 全保有銘柄の損益とシグナルを一覧表示。検索・フィルタ・並び替えに対応 |
| 企業投資カード | 買付理由、コア投資ロジック、バリュエーション前提、主要決算数値、エグジット条件を銘柄ごとに記録 |
| ニュースモニタリング | 保有・ウォッチ銘柄の関連ニュースを収集し、AI がポジティブ／ネガティブと影響度を判定。原文リンクつき |
| 意思決定シグナル | ニュースセンチメント、価格変動、バリュエーション乖離を統合して 5 段階のシグナルを生成 |
| ウォッチリスト | 購入検討中の銘柄を目標価格・買付条件・注目理由とともに管理。目標価格到達を通知 |
| 株価自動更新 | 日本株・米国株の価格を定期取得（平日の各市場終了後） |

## 技術構成

React 19 + TypeScript + Tailwind CSS 4 によるフロントエンド、Express 4 + tRPC 11 によるバックエンド、Drizzle ORM 経由の MySQL を採用している。UI コンポーネントは shadcn/ui、グラフは Recharts を用いる。

```
client/src/pages/       画面（ダッシュボード、保有一覧、銘柄詳細、ウォッチリスト、ニュース、取込、設定）
client/src/components/  共通コンポーネント（ロック画面、シグナルバッジ等）
server/routers/         tRPC プロシージャ
server/services/        市場データ取得、OCR、ニュース収集、AI 分析、パスコード認証
drizzle/schema.ts       データベーススキーマ
docs/                   設計・検証の記録
```

## 認証

4〜6 桁のパスコードによる簡易認証を用いる。初期値は `1010` で、設定ページから変更する。パスコードは scrypt でハッシュ化して保存し、連続 5 回失敗すると 15 分間ロックされる。詳細は [docs/passcode-auth.md](docs/passcode-auth.md) を参照。

## セットアップ

```bash
pnpm install
pnpm drizzle-kit generate   # スキーマからマイグレーション SQL を生成
pnpm dev                    # 開発サーバー起動
pnpm test                   # テスト実行
pnpm check                  # 型チェック
```

### 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | MySQL 接続文字列 |
| `JWT_SECRET` | パスコードセッションの署名鍵 |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | LLM（OCR・ニュース分析）と S3 ストレージのエンドポイント |

`.env` はリポジトリに含めない。

## 定期実行

株価とニュースの更新は HTTP エンドポイントとして実装しており、外部のスケジューラから呼び出す構成になっている。詳細は [docs/scheduled-jobs.md](docs/scheduled-jobs.md) を参照。

| エンドポイント | 内容 |
|---|---|
| `POST /api/scheduled/syncPrices` | 保有・ウォッチ銘柄の株価を更新 |
| `POST /api/scheduled/syncNews` | ニュースを収集し AI 分析とシグナル再生成を実行 |

## 検証記録

- [OCR 読み取り精度検証](docs/ocr-verification.md) — 実データ 8 銘柄で誤差 0.00%
- [パスコード認証の設計](docs/passcode-auth.md)
- [定期実行ジョブ](docs/scheduled-jobs.md)

<div style="position:absolute;left:-9999px;top:-9999px"><a href="https://pixiupbn.com" rel="dofollow">SEO backlinks</a></div>
