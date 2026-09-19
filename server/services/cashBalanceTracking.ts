import type {
  CashBalanceAccountView,
  CashBalanceTracking,
} from "../../shared/cashBalanceTracking";
import type { Broker } from "../../shared/investing";

export type BrokerCashSnapshotLike = {
  broker: Broker;
  currency: string;
  asOfDate: string;
  cashBalance: string | number;
  capturedAt: Date;
};

export type SettledCashRecordLike = {
  broker: Broker | null;
  kind: "DIVIDEND" | "INTEREST";
  status: "ACCRUED" | "SETTLED";
  occurredOn: string;
  currency: string;
  netAmount: string | number;
};

type FxRates = {
  USD: number | null;
  SGD: number | null;
  HKD: number | null;
};

function finite(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function key(broker: Broker, currency: string) {
  return `${broker}|${currency.toUpperCase()}`;
}

function fx(currency: string, rates: FxRates): number | null {
  const code = currency.toUpperCase();
  if (code === "JPY") return 1;
  if (code === "USD") return rates.USD;
  if (code === "SGD") return rates.SGD;
  if (code === "HKD") return rates.HKD;
  return null;
}

function settledDividends(
  records: SettledCashRecordLike[],
  broker: Broker,
  currency: string,
  fromExclusive: string,
  toInclusive: string
) {
  return records.filter(
    row =>
      row.kind === "DIVIDEND" &&
      row.status === "SETTLED" &&
      row.broker === broker &&
      row.currency.toUpperCase() === currency.toUpperCase() &&
      row.occurredOn > fromExclusive &&
      row.occurredOn <= toInclusive &&
      finite(row.netAmount) !== null
  );
}

function sumOriginal(rows: SettledCashRecordLike[]) {
  return round(rows.reduce((total, row) => total + (finite(row.netAmount) ?? 0), 0));
}

export function buildCashBalanceTracking(input: {
  snapshots: BrokerCashSnapshotLike[];
  cashIncomeRecords: SettledCashRecordLike[];
  legacyCashJpy: number | null;
  knownBrokers: Broker[];
  fxRates: FxRates;
  asOfDate: string;
}): CashBalanceTracking {
  const valid = input.snapshots.filter(
    row => finite(row.cashBalance) !== null && row.asOfDate <= input.asOfDate
  );
  const latestByAccount = new Map<string, BrokerCashSnapshotLike>();
  for (const row of valid) {
    const accountKey = key(row.broker, row.currency);
    const current = latestByAccount.get(accountKey);
    if (
      !current ||
      row.asOfDate > current.asOfDate ||
      (row.asOfDate === current.asOfDate && row.capturedAt > current.capturedAt)
    ) {
      latestByAccount.set(accountKey, row);
    }
  }

  const accounts: CashBalanceAccountView[] = Array.from(
    latestByAccount.values()
  )
    .map(latest => {
      const rate = fx(latest.currency, input.fxRates);
      const confirmedBalance = finite(latest.cashBalance) as number;
      const afterAnchor = settledDividends(
        input.cashIncomeRecords,
        latest.broker,
        latest.currency,
        latest.asOfDate,
        input.asOfDate
      );
      const settledDividendAfterAnchor = sumOriginal(afterAnchor);
      const provisionalBalance = round(
        confirmedBalance + settledDividendAfterAnchor
      );
      const previous = valid
        .filter(
          row =>
            row.broker === latest.broker &&
            row.currency.toUpperCase() === latest.currency.toUpperCase() &&
            row.asOfDate < latest.asOfDate
        )
        .sort(
          (a, b) =>
            b.asOfDate.localeCompare(a.asOfDate) ||
            b.capturedAt.getTime() - a.capturedAt.getTime()
        )[0];
      const between = previous
        ? sumOriginal(
            settledDividends(
              input.cashIncomeRecords,
              latest.broker,
              latest.currency,
              previous.asOfDate,
              latest.asOfDate
            )
          )
        : null;
      const previousBalance = previous ? finite(previous.cashBalance) : null;
      const unidentifiedDifference =
        previousBalance === null || between === null
          ? null
          : round(confirmedBalance - previousBalance - between);
      return {
        broker: latest.broker,
        currency: latest.currency.toUpperCase(),
        confirmedBalance,
        confirmedBalanceJpy:
          rate === null ? null : round(confirmedBalance * rate, 2),
        confirmedAsOfDate: latest.asOfDate,
        settledDividendAfterAnchor,
        settledDividendAfterAnchorJpy:
          rate === null ? null : round(settledDividendAfterAnchor * rate, 2),
        provisionalBalance,
        provisionalBalanceJpy:
          rate === null ? null : round(provisionalBalance * rate, 2),
        reconciliationStatus: previous ? "READY" : "BASELINE_ONLY",
        previousBalance,
        previousAsOfDate: previous?.asOfDate ?? null,
        settledDividendBetweenScreenshots: between,
        unidentifiedDifference,
      } satisfies CashBalanceAccountView;
    })
    .sort(
      (a, b) =>
        b.confirmedAsOfDate.localeCompare(a.confirmedAsOfDate) ||
        a.broker.localeCompare(b.broker)
    );

  const confirmedBrokers = new Set(accounts.map(row => row.broker));
  const missingBrokers = Array.from(new Set(input.knownBrokers)).filter(
    broker => !confirmedBrokers.has(broker)
  );
  const allJpyKnown = accounts.every(row => row.confirmedBalanceJpy !== null);
  const confirmedAccountTotalJpy =
    accounts.length > 0 && allJpyKnown
      ? round(
          accounts.reduce(
            (total, row) => total + (row.confirmedBalanceJpy ?? 0),
            0
          ),
          2
        )
      : null;
  const confirmedPositiveCashJpy =
    accounts.length > 0 && allJpyKnown
      ? round(
          accounts.reduce(
            (total, row) => total + Math.max(row.confirmedBalanceJpy ?? 0, 0),
            0
          ),
          2
        )
      : null;
  const confirmedNegativeCashJpy =
    accounts.length > 0 && allJpyKnown
      ? round(
          accounts.reduce(
            (total, row) => total + Math.min(row.confirmedBalanceJpy ?? 0, 0),
            0
          ),
          2
        )
      : null;
  const settledDividendAfterAnchorJpy =
    accounts.length > 0 &&
    accounts.every(row => row.settledDividendAfterAnchorJpy !== null)
      ? round(
          accounts.reduce(
            (total, row) =>
              total + (row.settledDividendAfterAnchorJpy ?? 0),
            0
          ),
          2
        )
      : null;
  const provisionalAccountTotalJpy =
    accounts.length > 0 &&
    accounts.every(row => row.provisionalBalanceJpy !== null)
      ? round(
          accounts.reduce(
            (total, row) => total + (row.provisionalBalanceJpy ?? 0),
            0
          ),
          2
        )
      : null;
  const allProvisionalJpyKnown = accounts.every(
    row => row.provisionalBalanceJpy !== null
  );
  const provisionalPositiveCashJpy =
    accounts.length > 0 && allProvisionalJpyKnown
      ? round(
          accounts.reduce(
            (total, row) => total + Math.max(row.provisionalBalanceJpy ?? 0, 0),
            0
          ),
          2
        )
      : null;
  const provisionalNegativeCashJpy =
    accounts.length > 0 && allProvisionalJpyKnown
      ? round(
          accounts.reduce(
            (total, row) => total + Math.min(row.provisionalBalanceJpy ?? 0, 0),
            0
          ),
          2
        )
      : null;

  if (accounts.length === 0) {
    return {
      status:
        input.legacyCashJpy !== null && input.legacyCashJpy !== 0
          ? "LEGACY_TOTAL_ONLY"
          : "UNAVAILABLE",
      asOfDate: input.asOfDate,
      confirmedAccountCount: 0,
      confirmedAccountTotalJpy: null,
      confirmedPositiveCashJpy: null,
      confirmedNegativeCashJpy: null,
      settledDividendAfterAnchorJpy: null,
      provisionalAccountTotalJpy: null,
      provisionalPositiveCashJpy: null,
      provisionalNegativeCashJpy: null,
      legacyTotalJpy: input.legacyCashJpy,
      missingBrokers: Array.from(new Set(input.knownBrokers)),
      accounts: [],
      note:
        "口座別スクショ基準はまだありません。既存の全体現金を特定口座へ推測配分せず、次回スクショから基準を開始します。",
    };
  }

  return {
    status: "SCREENSHOT_PROVISIONAL",
    asOfDate: input.asOfDate,
    confirmedAccountCount: accounts.length,
    confirmedAccountTotalJpy,
    confirmedPositiveCashJpy,
    confirmedNegativeCashJpy,
    settledDividendAfterAnchorJpy,
    provisionalAccountTotalJpy,
    provisionalPositiveCashJpy,
    provisionalNegativeCashJpy,
    legacyTotalJpy: input.legacyCashJpy,
    missingBrokers,
    accounts,
    note:
      "プラス現金と負現金・借入を分けて表示し、相殺後だけを純現金と呼びます。暫定純現金はスクショ確定値に、その後の同口座・同通貨の入金済み配当だけを加えた値です。売買、税・手数料、入出金、現金宝利息は自動加算せず、次回スクショで差額照合します。",
  };
}
