import { TRPCError } from "@trpc/server";

/**
 * AI 呼び出しで起こりうる失敗を、ユーザーが次の行動を判断できる日本語に変換する。
 *
 * 内蔵 LLM は利用枠を使い切ると `412 Precondition Failed – {"code":9,"message":"your account
 * has hit a usage exhausted"}` のような生のエラーを返す。これをそのまま画面に出しても
 * 「押しても何も起きない」ように見えるだけで、時間をおけば直るのか、設定が壊れているのか
 * 判断できない。原因ごとに対処法まで含めた文言へ置き換える。
 */
export function toFriendlyAiError(error: unknown, fallbackMessage: string): TRPCError {
  if (error instanceof TRPCError) return error;

  const message = error instanceof Error ? error.message : fallbackMessage;

  // 利用枠の上限。時間経過で回復するため、待つべきことと代替手段を伝える
  if (/usage exhausted|hit a usage|quota|429|412/i.test(message)) {
    return new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        "AI の利用枠を使い切ったため実行できませんでした。時間をおいてから再度お試しください（通常は数時間で回復します）。",
    });
  }

  // 認証エラー。設定側の問題なので待っても直らない
  if (/401|403|unauthorized|forbidden|invalid api key/i.test(message)) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "AI の認証に失敗しました。時間をおいても解消しない場合はお知らせください。",
    });
  }

  // タイムアウト。再試行で成功する可能性がある
  if (/timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(message)) {
    return new TRPCError({
      code: "TIMEOUT",
      message: "AI の応答が時間内に返りませんでした。もう一度お試しください。",
    });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

/** AI の利用枠上限によるエラーかどうか（呼び出し側で件数集計などに使う） */
export function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /usage exhausted|hit a usage|quota|429|412/i.test(message);
}
