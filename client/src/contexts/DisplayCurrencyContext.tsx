import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  convertFromBase,
  isDisplayCurrency,
  resolveDisplayCurrencyCode,
  shouldShowLocalHint,
  type DisplayCurrency,
  type FxRates,
} from "@shared/displayCurrency";
import { trpc } from "@/lib/trpc";

/**
 * 表示通貨を全画面で共有する。
 *
 * 保有一覧で USD に切り替えたのにダッシュボードが円のままだと
 * 数字を突き合わせられないため、画面をまたいで同じ通貨で見えるようにする。
 *
 * 保存先は端末側（localStorage）にする。
 * 「今どの通貨で見たいか」は同じ人でも端末や状況で変わる一時的な好みであり、
 * サーバーに持たせて全端末に波及させるほどのものではないため。
 */
const STORAGE_KEY = "investdesk.displayCurrency";

type Ctx = {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  fx: FxRates;
  /** 円建ての値を表示通貨に換算する。LOCAL のときは null（現地通貨をそのまま使う） */
  convert: (baseJpy: number | null | undefined) => number | null;
  /** 表示に使う通貨コード */
  codeFor: (localCurrency?: string | null) => string;
  /** 括弧内に現地通貨を併記すべきか */
  showLocalHint: (localCurrency?: string | null) => boolean;
};

const DisplayCurrencyContext = createContext<Ctx | null>(null);

function readStored(): DisplayCurrency {
  if (typeof window === "undefined") return "USD";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isDisplayCurrency(raw) ? raw : "USD";
}

export function DisplayCurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>(readStored);
  const settings = trpc.portfolio.settings.useQuery(undefined, { staleTime: 60_000 });

  const setCurrency = useCallback((c: DisplayCurrency) => {
    setCurrencyState(c);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, c);
  }, []);

  /*
   * 為替レートは株価更新と同時に自動取得している値を使う。
   * 取得前や異常値のときは換算せず現地通貨で出す方が安全なので 0 のままにし、
   * convertFromBase 側で null を返させる。
   */
  const fx = useMemo<FxRates>(
    () => ({
      usdJpy: Number(settings.data?.usdJpyRate ?? 0) || 0,
      sgdJpy: Number(settings.data?.sgdJpyRate ?? 0) || 0,
      hkdJpy: Number(settings.data?.hkdJpyRate ?? 0) || 0,
    }),
    [settings.data?.usdJpyRate, settings.data?.sgdJpyRate, settings.data?.hkdJpyRate]
  );

  const value = useMemo<Ctx>(
    () => ({
      currency,
      setCurrency,
      fx,
      convert: (baseJpy) => convertFromBase(baseJpy, currency, fx),
      codeFor: (localCurrency) => resolveDisplayCurrencyCode(currency, localCurrency),
      showLocalHint: (localCurrency) => shouldShowLocalHint(currency, localCurrency),
    }),
    [currency, setCurrency, fx]
  );

  return (
    <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>
  );
}

export function useDisplayCurrency(): Ctx {
  const ctx = useContext(DisplayCurrencyContext);
  if (!ctx) {
    /*
     * Provider の外で呼ばれた場合に落とさない。
     * 通貨切り替えは表示上の都合なので、欠けていても現地通貨で表示できれば実害がない。
     */
    const fallbackFx: FxRates = { usdJpy: 0, sgdJpy: 0, hkdJpy: 0 };
    return {
      currency: "LOCAL",
      setCurrency: () => {},
      fx: fallbackFx,
      convert: () => null,
      codeFor: (localCurrency) => localCurrency || "JPY",
      showLocalHint: () => false,
    };
  }
  return ctx;
}

/** 通貨切り替えを URL クエリからも受け取れるようにする（口座フィルタ等と同じ運用にするため） */
export function useSyncCurrencyFromQuery(raw: string | null | undefined) {
  const { setCurrency } = useDisplayCurrency();
  useEffect(() => {
    if (isDisplayCurrency(raw)) setCurrency(raw);
  }, [raw, setCurrency]);
}
