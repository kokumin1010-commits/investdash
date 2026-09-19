import type { Broker } from "./investing";

export type CashBalanceTrackingStatus =
  | "SCREENSHOT_PROVISIONAL"
  | "LEGACY_TOTAL_ONLY"
  | "UNAVAILABLE";

export type CashReconciliationStatus = "READY" | "BASELINE_ONLY";

export type CashBalanceAccountView = {
  broker: Broker;
  currency: string;
  confirmedBalance: number;
  confirmedBalanceJpy: number | null;
  confirmedAsOfDate: string;
  settledDividendAfterAnchor: number;
  settledDividendAfterAnchorJpy: number | null;
  provisionalBalance: number;
  provisionalBalanceJpy: number | null;
  reconciliationStatus: CashReconciliationStatus;
  previousBalance: number | null;
  previousAsOfDate: string | null;
  settledDividendBetweenScreenshots: number | null;
  unidentifiedDifference: number | null;
};

export type CashBalanceTracking = {
  status: CashBalanceTrackingStatus;
  asOfDate: string;
  confirmedAccountCount: number;
  confirmedAccountTotalJpy: number | null;
  confirmedPositiveCashJpy: number | null;
  confirmedNegativeCashJpy: number | null;
  settledDividendAfterAnchorJpy: number | null;
  provisionalAccountTotalJpy: number | null;
  provisionalPositiveCashJpy: number | null;
  provisionalNegativeCashJpy: number | null;
  legacyTotalJpy: number | null;
  missingBrokers: Broker[];
  accounts: CashBalanceAccountView[];
  note: string;
};
