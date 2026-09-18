import type { BrokerCashSnapshot, ImportJob } from "../../drizzle/schema";
import {
  BROKERS,
  brokerFromFormatId,
  type Broker,
} from "../../shared/investing";
import type { ScreenshotEvidence } from "../../shared/screenshotCashIncome";
import { guessFormatFromBrokerName } from "./brokerFormats";

type UnknownRecord = Record<string, unknown>;

export type ImportHistoryImage = {
  index: number;
  fileName: string | null;
  digest: string | null;
};

export type ImportHistoryItem = {
  jobId: number;
  broker: Broker;
  asOfDate: string;
  createdAt: Date;
  appliedCount: number;
  holdingCount: number;
  accountCashCount: number;
  interestCount: number;
  dividendCount: number;
  images: ImportHistoryImage[];
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isBroker(value: unknown): value is Broker {
  return typeof value === "string" && BROKERS.includes(value as Broker);
}

function jstDate(value: Date): string {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * 新しい複数画像ジョブでは parsed.evidence、初期の単画像ジョブでは
 * importJobs.fileKey / imageUrl を使う。履歴APIでは公開URLを返さず、画像番号だけを返す。
 */
export function getImportJobEvidence(job: ImportJob): ScreenshotEvidence[] {
  const parsed = asRecord(job.parsed);
  const evidence = asArray(parsed?.evidence)
    .map(item => {
      const record = asRecord(item);
      if (!record) return null;
      const fileKey = asString(record.fileKey);
      const imageUrl = asString(record.imageUrl);
      if (!fileKey && !imageUrl) return null;
      return {
        fileName: asString(record.fileName),
        fileKey,
        imageUrl,
        digest: asString(record.digest) ?? "",
      } satisfies ScreenshotEvidence;
    })
    .filter((item): item is ScreenshotEvidence => item !== null);

  if (evidence.length > 0) return evidence;
  if (!job.fileKey && !job.imageUrl) return [];
  return [
    {
      fileName: null,
      fileKey: job.fileKey,
      imageUrl: job.imageUrl,
      digest: "",
    },
  ];
}

function inferBroker(
  parsed: UnknownRecord | null,
  accountSummary: unknown
): Broker {
  const cashIncomeDraft = asRecord(parsed?.cashIncomeDraft);
  const accountCash = asRecord(cashIncomeDraft?.accountCash);
  if (isBroker(accountCash?.broker)) return accountCash.broker;

  for (const group of [
    cashIncomeDraft?.interestAssets,
    cashIncomeDraft?.dividendIncomes,
  ]) {
    for (const item of asArray(group)) {
      const broker = asRecord(item)?.broker;
      if (isBroker(broker)) return broker;
    }
  }

  const accountBroker = asString(asRecord(accountSummary)?.broker);
  return brokerFromFormatId(guessFormatFromBrokerName(accountBroker));
}

function inferAsOfDate(parsed: UnknownRecord | null, createdAt: Date): string {
  const cashIncomeDraft = asRecord(parsed?.cashIncomeDraft);
  const accountCash = asRecord(cashIncomeDraft?.accountCash);
  const accountCashDate = asString(accountCash?.asOfDate);
  if (accountCashDate) return accountCashDate;

  const dates = [
    ...asArray(cashIncomeDraft?.interestAssets).map(item =>
      asString(asRecord(item)?.asOfDate)
    ),
    ...asArray(cashIncomeDraft?.dividendIncomes).map(item =>
      asString(asRecord(item)?.occurredOn)
    ),
  ].filter((value): value is string => Boolean(value));
  if (dates.length > 0) return dates.sort().at(-1)!;

  return asString(cashIncomeDraft?.uploadDate) ?? jstDate(createdAt);
}

/** 保存済みジョブだけを、画像URLを露出しない履歴表示用データへ変換する。 */
export function summarizeImportJob(
  job: ImportJob,
  options: { cashSnapshot?: BrokerCashSnapshot | null } = {}
): ImportHistoryItem | null {
  if (job.status !== "APPLIED") return null;
  const evidence = getImportJobEvidence(job);
  if (evidence.length === 0) return null;

  const parsed = asRecord(job.parsed);
  const cashIncomeDraft = asRecord(parsed?.cashIncomeDraft);
  const rows = asArray(parsed?.rows);
  const holdingCount = rows.filter(
    row => asRecord(row)?.mode !== "SKIP"
  ).length;

  return {
    jobId: job.id,
    broker:
      options.cashSnapshot?.broker ?? inferBroker(parsed, job.accountSummary),
    asOfDate:
      options.cashSnapshot?.asOfDate ?? inferAsOfDate(parsed, job.createdAt),
    createdAt: job.createdAt,
    appliedCount: job.appliedCount,
    holdingCount,
    accountCashCount: accountCashIsApplied(cashIncomeDraft?.accountCash)
      ? 1
      : 0,
    interestCount: countApplied(cashIncomeDraft?.interestAssets),
    dividendCount: countApplied(cashIncomeDraft?.dividendIncomes),
    images: evidence.map((item, index) => ({
      index,
      fileName: item.fileName,
      digest: item.digest || null,
    })),
  };
}

function accountCashIsApplied(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(record && record.mode !== "SKIP");
}

function countApplied(value: unknown): number {
  return asArray(value).filter(item => asRecord(item)?.mode !== "SKIP").length;
}

export function getImportEvidenceAt(job: ImportJob, imageIndex: number) {
  if (job.status !== "APPLIED") return null;
  const evidence = getImportJobEvidence(job);
  return evidence[imageIndex] ?? null;
}
