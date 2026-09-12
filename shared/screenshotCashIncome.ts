import type { Broker } from "./investing";

export type ScreenshotDraftMode = "APPLY" | "SKIP";
export type ScreenshotDateSource = "SCREEN" | "UPLOAD_DATE";
export type InterestDeltaStatus =
  | "READY"
  | "ZERO"
  | "BASELINE_ONLY"
  | "BLOCKED";

export type ScreenshotInterestDraft = {
  draftKey: string;
  mode: ScreenshotDraftMode;
  broker: Broker;
  name: string;
  currency: string | null;
  amount: number | null;
  annualRatePct: number | null;
  dailyIncome: number | null;
  cumulativeIncome: number | null;
  asOfDate: string;
  dateSource: ScreenshotDateSource;
  confidence: number;
  evidence: string | null;
  existingInterestAssetId: number | null;
  previousCumulativeIncome: number | null;
  previousAsOfDate: string | null;
  periodIncome: number | null;
  deltaStatus: InterestDeltaStatus;
  issues: string[];
};

export type ScreenshotDividendDraft = {
  draftKey: string;
  mode: ScreenshotDraftMode;
  broker: Broker;
  symbol: string | null;
  name: string;
  currency: string | null;
  grossAmount: number | null;
  taxAmount: number | null;
  feeAmount: number | null;
  netAmount: number | null;
  occurredOn: string | null;
  confidence: number;
  evidence: string | null;
  issues: string[];
};

export type ScreenshotEvidence = {
  fileName: string | null;
  fileKey: string | null;
  imageUrl: string | null;
  digest: string;
};

export type ScreenshotCashIncomeDraft = {
  batchKey: string;
  uploadDate: string;
  model: string;
  interestAssets: ScreenshotInterestDraft[];
  dividendIncomes: ScreenshotDividendDraft[];
  evidence: ScreenshotEvidence[];
};

