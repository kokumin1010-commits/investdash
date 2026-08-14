/**
 * パスコードセッションの保存と読み出し。
 *
 * Manus OAuth の代わりに、パスコード検証で得たトークンを localStorage に置き、
 * すべての tRPC リクエストの Authorization ヘッダに載せる。
 * localStorage を使うのは、同じ端末なら次回以降の入力を省くため。
 */
const STORAGE_KEY = "investdesk-passcode-token";

/** 保存済みトークンを取得する */
export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** トークンを保存する */
export function storeToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // localStorage が使えない環境ではセッション内のみ有効
  }
}

/** トークンを破棄する（ロックする） */
export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

/**
 * 開発環境限定: URL の ?devToken=... を読み取ってトークンとして保存する。
 * スクリーンショット撮影のように localStorage が空のブラウザで
 * ロック画面を通過して画面を確認したいときに使う。
 * 本番ビルドでは何もしない。
 */
export function adoptTokenFromUrl(): void {
  if (!import.meta.env.DEV) return;
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("devToken");
    if (!token) return;
    storeToken(token);
    // URL からトークンを消して履歴に残さない
    params.delete("devToken");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    );
  } catch {
    // 解析に失敗しても通常フローは継続する
  }
}
