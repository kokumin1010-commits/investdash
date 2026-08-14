# 簡易パスコード認証

Manus OAuth ログインを廃止し、4〜6 桁の数字だけでアクセスできる方式に置き換えた。単一オーナー専用ツールという前提のため、パスコード 1 つがデータ所有者 1 人に対応する。

## 動作

初回アクセス時はロック画面が表示される。パスコードを入力して解錠すると、サーバーが JWT を発行し、クライアントは `localStorage` に保存する。以降は同じブラウザであれば入力不要で、トークンは 365 日有効である。サイドバー下部のメニューから「ロックする」を選ぶとトークンを破棄し、再入力を求める状態に戻る。

初期パスコードは `1010`。設定ページに初期値のままであることを示す警告が出るため、実運用前に変更する。

## セキュリティ設計

| 項目 | 内容 |
|---|---|
| 保存形式 | scrypt（N=2^15, r=8, p=1, 32 バイト出力）＋ 16 バイトのランダムソルト。平文は保持しない |
| 比較方法 | `timingSafeEqual` によりタイミング攻撃を回避 |
| 総当たり対策 | 連続 5 回失敗で 15 分間ロック。成功時に失敗カウントをリセット |
| トークン | HS256 署名の JWT。`scope: "passcode"` を検証し、他用途のトークンを流用できないようにした |

パスコードは 4〜6 桁しかないため、理論上の候補数は最大 110 万通りにとどまる。この短さを補うのが scrypt とロック機構である。scrypt はメモリを要求するため GPU による並列総当たりに強く、1 回の検証に約 0.1 秒かかる。オンライン攻撃については 5 回失敗で 15 分ロックとなるため、1 時間あたり試行できるのは 20 回程度に制限される。

## 実装箇所

| ファイル | 役割 |
|---|---|
| `server/services/passcode.ts` | ハッシュ化、検証、トークン発行、ロック判定 |
| `server/routers/authRouter.ts` | `unlock` / `changePasscode` / `usingDefaultPasscode` |
| `server/_core/context.ts` | `Authorization: Bearer` からパスコードセッションを解決 |
| `client/src/contexts/PasscodeContext.tsx` | 解錠状態の管理 |
| `client/src/components/PasscodeGate.tsx` | ロック画面（数字キーパッド、物理キーボード対応） |
| `client/src/components/PasscodeSettings.tsx` | 設定ページのパスコード変更フォーム |
| `client/src/lib/passcodeSession.ts` | トークンの localStorage 読み書き |

従来の Manus OAuth 経路は `server/_core/context.ts` に残してあり、定期実行ジョブ（cron）の認証に使われる。

## 運用上の注意

パスコードを忘れた場合は復元できない。その場合はデータベースの `passcodeAuth` テーブルの行を削除すると、次回アクセス時に初期パスコード `1010` で再セットアップされる。

```sql
DELETE FROM passcodeAuth;
```
