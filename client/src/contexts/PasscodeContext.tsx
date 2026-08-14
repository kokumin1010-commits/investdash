/**
 * パスコードによるアクセス制御。
 *
 * トークンが localStorage にあれば認証済みとして扱い、`auth.me` で実際に
 * 有効かどうかを確認する。無効ならロック画面を出す。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { clearToken, getStoredToken, storeToken } from "@/lib/passcodeSession";

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
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const utils = trpc.useUtils();

  // トークンがある場合のみ有効性を確認する
  const me = trpc.auth.me.useQuery(undefined, {
    enabled: token !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const unlockMutation = trpc.auth.unlock.useMutation();

  const unlock = useCallback(
    async (passcode: string) => {
      const res = await unlockMutation.mutateAsync({ passcode });
      storeToken(res.token);
      setToken(res.token);
      // ヘッダに新しいトークンが載った状態で全クエリを取り直す
      await utils.invalidate();
    },
    [unlockMutation, utils]
  );

  const lock = useCallback(() => {
    clearToken();
    setToken(null);
    utils.invalidate();
  }, [utils]);

  const value = useMemo<PasscodeContextValue>(() => {
    // トークンが無い → 未解錠（確認不要）
    if (token === null) {
      return { unlocked: false, checking: false, unlock, lock };
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
  }, [token, me.isLoading, me.isError, me.data, unlock, lock]);

  return <PasscodeContext.Provider value={value}>{children}</PasscodeContext.Provider>;
}

export function usePasscode(): PasscodeContextValue {
  const ctx = useContext(PasscodeContext);
  if (!ctx) throw new Error("usePasscode must be used within PasscodeProvider");
  return ctx;
}
