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
