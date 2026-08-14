# 作業メモ（引き継ぎ用）

## ユーザーの要望と決定事項

ユーザーは自身の株式ポートフォリオ（楽天証券、日本株 8 銘柄、純資産約 8,976 万円）を管理する意思決定支援ツールを求めている。入力は主にスマートフォンのスクリーンショットで行う方針。

| 項目 | 決定内容 |
|---|---|
| 認証 | Manus ログインは不要。4〜6 桁のパスコード方式を選択（初期値 1010）。実装済み |
| ドメイン | `buzzdeta.com` を使用予定。取得元・サブドメイン構成は未確認 |
| ホスティング | 将来的に Railway へ移行したい意向。Manus に依存しない形を望む。ただし当面は Manus 上で完成させ、実際に使ってから移行する方針で合意 |
| GitHub | `kokumin1010-commits/investdash`（Public）へコードをプッシュする |

## Railway 移行時に対応が必要な箇所

移行を実施する際、Manus 固有の機能に依存している以下を差し替える必要がある。

| 依存 | 現在 | 移行後に必要なもの |
|---|---|---|
| LLM（OCR・ニュース分析） | `BUILT_IN_FORGE_API_URL` 経由の内蔵 LLM（gemini-3.1-pro-preview） | Google Gemini または OpenAI の API キーを自前で契約 |
| ファイル保存 | Manus の S3（`server/storage.ts`） | Cloudflare R2 等の外部 S3 |
| データベース | Manus 管理の MySQL | Railway の MySQL＋データ移行 |
| 定期実行 | Manus Heartbeat（3 ジョブ登録済み） | Railway Cron |
| 認証 | パスコード方式（Manus 非依存） | 変更不要 |

LLM 呼び出しは `server/_core/llm.ts` の `invokeLLM` に集約されているため、差し替え箇所は限定的である。OCR は `server/services/ocr.ts`、ニュース分析は `server/services/analysis.ts` から呼ばれている。

## ユーザーの実際の保有銘柄（OCR 検証で確認）

SUBARU(7270)、東京地下鉄(9023)、モルフォ(3653)、ソシオネクスト(6526)、ヤクルト本社(2267)、オリエンタルランド(4661)、キヤノン(7751)、楽天グループ(4755)。全銘柄が含み損の状態。

## 現在の公開状況

本番 URL: `investdash-h5pd9fya.manus.space`（デプロイ済み）

パスコード認証を追加した後は再デプロイが必要。
