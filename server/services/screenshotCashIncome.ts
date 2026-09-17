import { createHash } from "node:crypto";
import type {
  ScreenshotAccountCashDraft,
  ScreenshotCashIncomeDraft,
  ScreenshotDividendDraft,
  ScreenshotEvidence,
  ScreenshotInterestDraft,
} from "../../shared/screenshotCashIncome";
import {
  brokerFromFormatId,
  type Broker,
} from "../../shared/investing";
import type {
  ParsedAccount,
  ParsedDividendIncome,
  ParsedInterestAsset,
} from "./ocr";
import {
  guessFormatFromBrokerName,
  type BrokerFormatId,
} from "./brokerFormats";

export type ExistingBrokerCashSnapshotLike = {
  broker: Broker;
  currency: string;
  asOfDate: string;
  cashBalance: string | number;
  capturedAt: Date;
};

export type ExistingCashIncomeRecordLike = {
  broker: Broker | null;
  kind: "DIVIDEND" | "INTEREST";
  status: "ACCRUED" | "SETTLED";
  occurredOn: string;
  currency: string;
  netAmount: string | number;
};

export type ExistingInterestAssetLike = {
  id: number;
  broker: Broker;
  name: string;
  currency: string;
  cumulativeIncome: string | number | null;
  capturedAt: Date;
};

export type InterestSnapshotLike = {
  interestAssetId: number;
  broker: Broker;
  name: string;
  currency: string;
  incomeDate: string;
  cumulativeIncome: string | number | null;
  capturedAt: Date;
};

function finite(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function identityName(value: string) {
  return value.trim().toLowerCase().replace(/[\s　]+/g, "");
}

function identity(broker: Broker, name: string, currency: string | null) {
  return `${broker}|${identityName(name)}|${currency ?? "?"}`;
}

function hash(...values: string[]) {
  return createHash("sha256").update(values.join("\u001f")).digest("hex").slice(0, 32);
}

function resolveBroker(value: string | null, selectedFormatId: BrokerFormatId): Broker {
  const detected = guessFormatFromBrokerName(value);
  return brokerFromFormatId(detected === "generic" ? selectedFormatId : detected);
}

function findExistingAsset(
  assets: ExistingInterestAssetLike[],
  broker: Broker,
  name: string,
  currency: string | null
) {
  const key = identity(broker, name, currency);
  return assets.find(asset => identity(asset.broker, asset.name, asset.currency.toUpperCase()) === key) ?? null;
}

export function findPreviousCumulativeIncome(
  snapshots: InterestSnapshotLike[],
  asset: ExistingInterestAssetLike | null,
  broker: Broker,
  name: string,
  currency: string | null,
  asOfDate: string
): { cumulativeIncome: number; asOfDate: string } | null {
  const key = identity(broker, name, currency);
  const previous = snapshots
    .filter(row => {
      if (row.incomeDate >= asOfDate) return false;
      if (asset && row.interestAssetId === asset.id) return true;
      return identity(row.broker, row.name, row.currency.toUpperCase()) === key;
    })
    .filter(row => finite(row.cumulativeIncome) !== null)
    .sort((a, b) => b.incomeDate.localeCompare(a.incomeDate) || b.capturedAt.getTime() - a.capturedAt.getTime())[0];
  if (previous) {
    return {
      cumulativeIncome: finite(previous.cumulativeIncome) as number,
      asOfDate: previous.incomeDate,
    };
  }
  if (!asset || asset.capturedAt.toISOString().slice(0, 10) >= asOfDate) return null;
  const cumulative = finite(asset.cumulativeIncome);
  return cumulative === null
    ? null
    : {
        cumulativeIncome: cumulative,
        asOfDate: asset.capturedAt.toISOString().slice(0, 10),
      };
}

function buildInterestDraft(input: {
  row: ParsedInterestAsset;
  batchKey: string;
  index: number;
  uploadDate: string;
  selectedFormatId: BrokerFormatId;
  existingAssets: ExistingInterestAssetLike[];
  snapshots: InterestSnapshotLike[];
}): ScreenshotInterestDraft {
  const row = input.row;
  const broker = resolveBroker(row.broker, input.selectedFormatId);
  const currency = row.currency?.toUpperCase() ?? null;
  const asOfDate = row.asOfDate ?? input.uploadDate;
  const dateSource = row.asOfDate ? "SCREEN" : "UPLOAD_DATE";
  const existing = findExistingAsset(input.existingAssets, broker, row.name, currency);
  const previous = findPreviousCumulativeIncome(
    input.snapshots,
    existing,
    broker,
    row.name,
    currency,
    asOfDate
  );
  const currentCumulative = finite(row.cumulativeIncome);
  const issues: string[] = [];
  if (!currency) issues.push("通貨を読み取れませんでした");
  if (row.amount === null) issues.push("現在残高を読み取れませんでした");
  if (!row.asOfDate) issues.push("画面に基準日がないためアップロード日を仮採用します");
  if (row.confidence < 60) issues.push("読み取り確信度が低いため確認が必要です");

  let periodIncome: number | null = null;
  let deltaStatus: ScreenshotInterestDraft["deltaStatus"] = "BASELINE_ONLY";
  if (currentCumulative === null) {
    issues.push("累計収益がないため前回比を計算できません");
  } else if (!previous) {
    issues.push("前回の累計収益がないため今回は比較基準として保存します");
  } else if (previous.asOfDate >= asOfDate) {
    deltaStatus = "BLOCKED";
    issues.push("前回記録より新しい基準日を確認できません");
  } else if (currentCumulative < previous.cumulativeIncome) {
    deltaStatus = "BLOCKED";
    issues.push("累計収益が前回より減少しているため自動差額を停止しました");
  } else {
    periodIncome = round(currentCumulative - previous.cumulativeIncome);
    deltaStatus = periodIncome === 0 ? "ZERO" : "READY";
  }

  const requiredMissing = !currency || row.amount === null;
  const blocked = requiredMissing || deltaStatus === "BLOCKED" || row.confidence < 60;
  const draftKey = hash(
    input.batchKey,
    "interest",
    identity(broker, row.name, currency),
    asOfDate,
    String(input.index)
  );
  return {
    draftKey,
    mode: blocked ? "SKIP" : "APPLY",
    broker,
    name: row.name,
    currency,
    amount: row.amount,
    annualRatePct: row.annualRatePct,
    dailyIncome: row.dailyIncome,
    cumulativeIncome: row.cumulativeIncome,
    asOfDate,
    dateSource,
    confidence: row.confidence,
    evidence: row.evidence,
    existingInterestAssetId: existing?.id ?? null,
    previousCumulativeIncome: previous?.cumulativeIncome ?? null,
    previousAsOfDate: previous?.asOfDate ?? null,
    periodIncome,
    deltaStatus,
    issues,
  };
}

function buildDividendDraft(input: {
  row: ParsedDividendIncome;
  batchKey: string;
  index: number;
  selectedFormatId: BrokerFormatId;
}): ScreenshotDividendDraft {
  const row = input.row;
  const broker = resolveBroker(row.broker, input.selectedFormatId);
  const currency = row.currency?.toUpperCase() ?? null;
  const issues: string[] = [];
  const allDeductionsKnown = row.taxAmount !== null && row.feeAmount !== null;
  const breakdownNet =
    row.grossAmount !== null && allDeductionsKnown
      ? round(row.grossAmount - (row.taxAmount ?? 0) - (row.feeAmount ?? 0))
      : null;
  const computedNet =
    row.netAmount ??
    breakdownNet;
  if (!currency) issues.push("通貨を読み取れませんでした");
  if (!row.occurredOn) issues.push("実際の入金日を読み取れませんでした");
  if (computedNet === null) issues.push("実際の入金額を読み取れませんでした");
  if (computedNet !== null && computedNet < 0) issues.push("税・手数料控除後の金額が0未満です");
  if (
    row.netAmount !== null &&
    breakdownNet !== null &&
    Math.abs(row.netAmount - breakdownNet) >
      Math.max(0.01, Math.abs(row.netAmount) * 0.001)
  ) {
    issues.push("税前額・税・手数料と入金額が一致しません");
  }
  if (row.grossAmount === null) issues.push("税前額は画面にないため未取得のまま保存します");
  if (row.confidence < 60) issues.push("読み取り確信度が低いため確認が必要です");
  const blocked = !currency || !row.occurredOn || computedNet === null || computedNet < 0 || row.confidence < 60 || issues.some(issue => issue.includes("一致しません"));
  const draftKey = hash(
    input.batchKey,
    "dividend",
    broker,
    row.occurredOn ?? "?",
    row.symbol ?? row.name,
    currency ?? "?",
    String(computedNet ?? "?"),
    String(input.index)
  );
  return {
    draftKey,
    mode: blocked ? "SKIP" : "APPLY",
    broker,
    symbol: row.symbol,
    name: row.name,
    currency,
    grossAmount: row.grossAmount,
    taxAmount: row.taxAmount,
    feeAmount: row.feeAmount,
    netAmount: computedNet,
    occurredOn: row.occurredOn,
    confidence: row.confidence,
    evidence: row.evidence,
    issues,
  };
}

function buildAccountCashDraft(input: {
  account: ParsedAccount;
  batchKey: string;
  uploadDate: string;
  selectedFormatId: BrokerFormatId;
  cashSnapshots: ExistingBrokerCashSnapshotLike[];
  cashIncomeRecords: ExistingCashIncomeRecordLike[];
}): ScreenshotAccountCashDraft | null {
  const cashBalance = finite(input.account.cash);
  if (cashBalance === null) return null;

  const broker = resolveBroker(input.account.broker, input.selectedFormatId);
  const currency = input.account.currency?.toUpperCase() ?? null;
  const asOfDate = input.account.cashAsOfDate ?? input.uploadDate;
  const dateSource = input.account.cashAsOfDate ? "SCREEN" : "UPLOAD_DATE";
  const previous = input.cashSnapshots
    .filter(
      row =>
        row.broker === broker &&
        currency !== null &&
        row.currency.toUpperCase() === currency &&
        row.asOfDate < asOfDate &&
        finite(row.cashBalance) !== null
    )
    .sort(
      (a, b) =>
        b.asOfDate.localeCompare(a.asOfDate) ||
        b.capturedAt.getTime() - a.capturedAt.getTime()
    )[0];
  const periodDividends = previous
    ? input.cashIncomeRecords.filter(
        row =>
          row.kind === "DIVIDEND" &&
          row.status === "SETTLED" &&
          row.broker === broker &&
          currency !== null &&
          row.currency.toUpperCase() === currency &&
          row.occurredOn > previous.asOfDate &&
          row.occurredOn <= asOfDate &&
          finite(row.netAmount) !== null
      )
    : [];
  const settledDividendBetween = previous
    ? round(
        periodDividends.reduce(
          (total, row) => total + (finite(row.netAmount) ?? 0),
          0
        )
      )
    : null;
  const previousBalance = previous ? finite(previous.cashBalance) : null;
  const expectedBalance =
    previousBalance === null || settledDividendBetween === null
      ? null
      : round(previousBalance + settledDividendBetween);
  const unidentifiedDifference =
    expectedBalance === null ? null : round(cashBalance - expectedBalance);
  const issues: string[] = [];
  if (!currency) issues.push("通貨を読み取れませんでした");
  if (!input.account.cashAsOfDate) {
    issues.push("画面に基準日がないためアップロード日を仮採用します");
  }
  if (input.account.confidence < 60) {
    issues.push("現金残高の読み取り確信度が低いため確認が必要です");
  }
  if (!previous) {
    issues.push("前回の口座別現金がないため今回は比較基準として保存します");
  }
  const blocked = !currency || input.account.confidence < 60;
  return {
    draftKey: hash(
      input.batchKey,
      "account-cash",
      broker,
      currency ?? "?",
      asOfDate
    ),
    mode: blocked ? "SKIP" : "APPLY",
    broker,
    currency,
    cashBalance,
    asOfDate,
    dateSource,
    confidence: input.account.confidence,
    evidence: input.account.evidence,
    previousBalance,
    previousAsOfDate: previous?.asOfDate ?? null,
    settledDividendBetween,
    expectedBalance,
    unidentifiedDifference,
    reconciliationStatus: blocked
      ? "BLOCKED"
      : previous
        ? "READY"
        : "BASELINE_ONLY",
    issues,
  };
}

export function buildScreenshotCashIncomeDraft(input: {
  batchKey: string;
  uploadDate: string;
  model: string;
  selectedFormatId: BrokerFormatId;
  account?: ParsedAccount;
  interestAssets: ParsedInterestAsset[];
  dividendIncomes: ParsedDividendIncome[];
  existingAssets: ExistingInterestAssetLike[];
  snapshots: InterestSnapshotLike[];
  cashSnapshots?: ExistingBrokerCashSnapshotLike[];
  cashIncomeRecords?: ExistingCashIncomeRecordLike[];
  evidence: ScreenshotEvidence[];
}): ScreenshotCashIncomeDraft {
  return {
    batchKey: input.batchKey,
    uploadDate: input.uploadDate,
    model: input.model,
    accountCash: input.account
      ? buildAccountCashDraft({
          account: input.account,
          batchKey: input.batchKey,
          uploadDate: input.uploadDate,
          selectedFormatId: input.selectedFormatId,
          cashSnapshots: input.cashSnapshots ?? [],
          cashIncomeRecords: input.cashIncomeRecords ?? [],
        })
      : null,
    interestAssets: input.interestAssets.map((row, index) =>
      buildInterestDraft({
        row,
        index,
        batchKey: input.batchKey,
        uploadDate: input.uploadDate,
        selectedFormatId: input.selectedFormatId,
        existingAssets: input.existingAssets,
        snapshots: input.snapshots,
      })
    ),
    dividendIncomes: input.dividendIncomes.map((row, index) =>
      buildDividendDraft({
        row,
        index,
        batchKey: input.batchKey,
        selectedFormatId: input.selectedFormatId,
      })
    ),
    evidence: input.evidence,
  };
}

/** 確認保存時も同じ式で再計算するための公開関数。 */
export function calculateCumulativeIncomeDelta(input: {
  currentCumulativeIncome: number | null;
  currentAsOfDate: string;
  previousCumulativeIncome: number | null;
  previousAsOfDate: string | null;
}) {
  if (input.currentCumulativeIncome === null || input.previousCumulativeIncome === null || !input.previousAsOfDate) {
    return { status: "BASELINE_ONLY" as const, amount: null };
  }
  if (input.previousAsOfDate >= input.currentAsOfDate || input.currentCumulativeIncome < input.previousCumulativeIncome) {
    return { status: "BLOCKED" as const, amount: null };
  }
  const amount = round(input.currentCumulativeIncome - input.previousCumulativeIncome);
  return { status: amount === 0 ? ("ZERO" as const) : ("READY" as const), amount };
}
