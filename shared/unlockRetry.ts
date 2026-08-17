/**
 * パスコード解錠の失敗を分類し、一時的な失敗だけ再試行する。
 *
 * 背景: デプロイの切り替え中や起動直後は、サーバーが JSON ではなく HTML の
 * エラーページを返すことがある。tRPC はそれを解析できず
 * 「Unexpected token '<', "<html><hea"... is not valid JSON」という
 * 内部的な例外をそのまま投げる。パスコードは合っているのに解錠できず、
 * 文面からは原因も分からないため、利用者は何度も入力し直すしかない。
 */

/** 解錠の失敗の種類 */
export type UnlockFailure =
  /** パスコードが違う。再試行しても意味がない */
  | "WRONG_PASSCODE"
  /** サーバーが JSON を返さなかった。起動待ちやデプロイ中に起きる */
  | "SERVER_NOT_READY"
  /** 通信できなかった */
  | "NETWORK"
  /** 分類できない */
  | "UNKNOWN";

/**
 * エラーの内容から失敗の種類を判定する。
 *
 * メッセージの文字列で判定する。tRPC はサーバーの応答が JSON でない場合に
 * エラーコードを付けられないため（コードは JSON の中にある）、
 * 文面以外に手掛かりがない。
 */
export function classifyUnlockFailure(err: unknown): UnlockFailure {
  const msg = err instanceof Error ? err.message : String(err ?? "");

  /*
   * パスコード違いを最初に判定する。
   * サーバーが返す文面（「パスコードが違います」）を含むため、
   * これを一時的な失敗と誤って再試行すると、間違ったパスコードで
   * 何度も試すことになり解錠の遅れと無駄な通信になる。
   */
  if (/パスコードが違|UNAUTHORIZED|401/.test(msg)) return "WRONG_PASSCODE";

  /*
   * HTML が返ってきたときの典型的な文面。
   * ブラウザによって書き方が違うため複数を見る。
   * - Chrome: Unexpected token '<', "<html><hea"... is not valid JSON
   * - Safari: Unexpected token '<'
   * - Firefox: JSON.parse: unexpected character
   */
  if (
    /Unexpected token '<'/.test(msg) ||
    /is not valid JSON/.test(msg) ||
    /JSON\.parse/.test(msg) ||
    /<html/i.test(msg) ||
    /Unexpected end of JSON input/.test(msg)
  ) {
    return "SERVER_NOT_READY";
  }

  if (/Failed to fetch|NetworkError|network|ECONNREFUSED|timeout|応答がありません/i.test(msg)) {
    return "NETWORK";
  }

  return "UNKNOWN";
}

/** 再試行してよい失敗かどうか */
export function isRetryableUnlockFailure(kind: UnlockFailure): boolean {
  return kind === "SERVER_NOT_READY" || kind === "NETWORK";
}

/**
 * 利用者に見せる文面。
 *
 * 「Unexpected token '<'」のような内部的な文面をそのまま出しても、
 * 何をすればよいか分からない。原因と次の行動を書く。
 */
export function unlockFailureMessage(kind: UnlockFailure): string {
  switch (kind) {
    case "WRONG_PASSCODE":
      return "パスコードが違います。";
    case "SERVER_NOT_READY":
      return "サーバーの準備中です。数秒おいてもう一度お試しください。";
    case "NETWORK":
      return "通信できませんでした。接続を確認して再度お試しください。";
    default:
      return "解錠できませんでした。時間をおいて再度お試しください。";
  }
}

/** 再試行の待ち時間（ミリ秒）。起動待ちを想定して間隔を空ける */
export const UNLOCK_RETRY_DELAYS_MS = [700, 1800] as const;

/**
 * 解錠を実行し、一時的な失敗なら自動で再試行する。
 *
 * 再試行は 2 回まで。無制限に粘ると、本当にサーバーが落ちている場合に
 * 画面が固まったように見える。
 */
export async function unlockWithRetry<T>(
  attempt: () => Promise<T>,
  options?: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> }
): Promise<T> {
  const delays = options?.delaysMs ?? UNLOCK_RETRY_DELAYS_MS;
  const sleep = options?.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  let lastError: unknown = null;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      const kind = classifyUnlockFailure(err);
      // 再試行しても直らない失敗は、その場で分かりやすい文面にして投げる
      if (!isRetryableUnlockFailure(kind)) {
        throw new Error(unlockFailureMessage(kind));
      }
      if (i < delays.length) await sleep(delays[i]);
    }
  }
  throw new Error(unlockFailureMessage(classifyUnlockFailure(lastError)));
}
