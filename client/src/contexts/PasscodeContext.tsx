/**
 * パスコードによるアクセス制御。
 *
 * トークンが localStorage にあれば認証済みとして扱い、`auth.me` で実際に
 * 有効かどうかを確認する。無効ならロック画面を出す。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { clearToken, getStoredToken, storeToken } from "@/lib/passcodeSession";
import { unlockWithRetry } from "../../../shared/unlockRetry";

type PasscodeContextValue = {
  /** 認証済みかどうか */
  unlocked: boolean;
  /** 認証状態の確認中 */
  checking: boolean;
  /** パスコードを検証して解錠する */
  unlock: (passcode: string) => Promise<void>;
  /** 解錠状態を破棄する */
  lock: () => void;
};

const PasscodeContext = createContext<PasscodeContextValue | null>(null);

export function PasscodeProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("forceLock") === "1") {
        clearToken();
        return null;
      }
    }

    const stored = getStoredToken();
    if (stored) return stored;

    if (import.meta.env.DEV) {
      const previewToken = new URLSearchParams(window.location.search).get("devToken");
      if (previewToken) {
        storeToken(previewToken);
        return previewToken;
      }
    }

    return null;
  });
  // 解錠操作を経た直後は auth.me の検証結果を待たずに解錠済みとして扱う。
  // トークンはサーバーが発行した直後なので有効性は確定している。
  const [justUnlocked, setJustUnlocked] = useState(false);
  const utils = trpc.useUtils();

  // トークンがある場合のみ有効性を確認する
  const me = trpc.auth.me.useQuery(undefined, {
    enabled: token !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const unlockMutation = trpc.auth.unlock.useMutation();

  /**
   * 解錠は一時的な失敗を自分で吸収する。
   *
   * デプロイの切り替え中や起動直後は、サーバーが JSON ではなく HTML の
   * エラーページを返すことがある。そのとき tRPC は
   * 「Unexpected token '<', "<html><hea"... is not valid JSON」という
   * 内部的な例外をそのまま投げる。パスコードが合っているのに解錠できず、
   * しかも文面から原因が分からないため、利用者は何度も入力し直すしかない。
   *
   * 一時的な失敗（通信・サーバー起動待ち）と本当の間違い（パスコード違い）
   * を区別し、前者は自動で再試行する。
   */
  const unlock = useCallback(
    async (passcode: string) => {
      const res = await unlockWithRetry(() => unlockMutation.mutateAsync({ passcode }));
      storeToken(res.token);
      setToken(res.token);
      setJustUnlocked(true);
      // 全クエリの再取得完了を待つと、いずれかのクエリが遅い場合に
      // ロック画面が解除されないため、待たずに投げるだけにする。
      void utils.invalidate();
    },
    [unlockMutation, utils]
  );

  const lock = useCallback(() => {
    clearToken();
    setToken(null);
    setJustUnlocked(false);
    utils.invalidate();
  }, [utils]);

  const value = useMemo<PasscodeContextValue>(() => {
    // トークンが無い → 未解錠（確認不要）
    if (token === null) {
      return { unlocked: false, checking: false, unlock, lock };
    }
    // 解錠直後は検証を待たずに通す
    if (justUnlocked) {
      return { unlocked: true, checking: false, unlock, lock };
    }
    // トークンはあるが検証中
    if (me.isLoading) {
      return { unlocked: false, checking: true, unlock, lock };
    }
    // 検証に失敗（トークン失効）→ 未解錠
    if (me.isError || !me.data) {
      return { unlocked: false, checking: false, unlock, lock };
    }
    return { unlocked: true, checking: false, unlock, lock };
  }, [token, justUnlocked, me.isLoading, me.isError, me.data, unlock, lock]);

  return <PasscodeContext.Provider value={value}>{children}</PasscodeContext.Provider>;
}

export function usePasscode(): PasscodeContextValue {
  const ctx = useContext(PasscodeContext);
  if (!ctx) throw new Error("usePasscode must be used within PasscodeProvider");
  return ctx;
}
