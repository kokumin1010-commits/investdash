# 定期実行ジョブ（Heartbeat）

本番サイト（investdash-h5pd9fya.manus.space）に対して、Manus プラットフォームが直接 HTTP POST を送る形で定期実行される。サンドボックスの稼働状態とは無関係に動作する。

cron 式は 6 フィールド（秒 分 時 日 月 曜日）で **UTC 基準**。日本時間は UTC+9。

| ジョブ名 | 実行タイミング（JST） | cron（UTC） | 呼び出し先 | task_uid |
|---|---|---|---|---|
| daily-sync-prices | 平日 15:30 | `0 30 6 * * 1-5` | `/api/scheduled/syncPrices` | GpEH2egTRbCnFQh9adRb45 |
| us-close-sync-prices | 平日 翌 6:30 | `0 30 21 * * 1-5` | `/api/scheduled/syncPrices` | jBchHnuuqPsnb8A5y6UeCA |
| daily-sync-news | 毎日 7:00 | `0 0 22 * * *` | `/api/scheduled/syncNews` | A7KESCXZRfLzumvnfEBer3 |

## 設計意図

株価更新を 1 日 2 回に分けているのは、日本株と米国株で取引時間が異なるためである。日本市場は JST 15:00 に取引を終えるため 15:30 に更新し、米国市場（夏時間で JST 翌 5:00 終了）に対しては翌 6:30 に更新する。いずれも平日のみ実行する。

ニュース取得と AI 分析は毎日 7:00 に実行する。この時点で日本株・米国株の直前営業日の値動きが揃っているため、価格変動とニュースセンチメントを合わせたシグナル判定が可能になる。ニュース取得は土日も実行する（週末に出る決算・適時開示を拾うため）。

ハンドラはいずれも冪等で、失敗したユーザーはスキップして処理を継続する。1 回あたりのタイムアウトは 2 分である。

## 運用コマンド

```bash
manus-heartbeat list                              # 一覧
manus-heartbeat logs --task-uid <uid>             # 実行履歴
manus-heartbeat logs --task-uid <uid> --status failed --with-body
manus-heartbeat pause  --task-uid <uid>           # 一時停止
manus-heartbeat resume --task-uid <uid>           # 再開
manus-heartbeat update --task-uid <uid> --cron "0 0 23 * * *"
```

manus.im のプロジェクト画面（Settings → Schedules）からも実行履歴の確認、一時停止／再開、Run Now による手動実行ができる。
