import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { checkExecutions } from "../services/outcomeService";
import { reconcileApprovedActionQueue } from "../services/actionQueueService";
import {
  compareLatestMonths,
  compareMonths,
  deleteMonthlySnapshot,
  listMonthlySnapshots,
  saveMonthlySnapshot,
} from "../services/monthlySnapshotService";
import { storagePut } from "../storage";
import { extractPositions, type ParsedPosition } from "../services/ocr";
import {
  buildScreenshotCashIncomeDraft,
  calculateCumulativeIncomeDelta,
  findPreviousCumulativeIncome,
} from "../services/screenshotCashIncome";
import {
  BROKER_FORMAT_IDS,
  BROKER_FORMAT_OPTIONS,
  guessFormatFromBrokerName,
} from "../services/brokerFormats";
import { toFriendlyAiError } from "../services/aiErrors";
import { fetchCompanyProfile, fetchQuote } from "../services/marketData";
import {
  brokerFromFormatId,
  BROKERS,
  normalizeSymbol,
  MARKETS,
  MARKET_CURRENCY,
  type Market,
} from "../../shared/investing";

/** 承認前にユーザーへ提示する行 */
const rowSchema = z.object({
  name: z.string().min(1).max(160),
  tickerCode: z.string().min(1).max(16),
  quantity: z.number().nullable(),
  avgCost: z.number().nullable(),
  currentPrice: z.number().nullable(),
  marketValue: z.number().nullable(),
  pnl: z.number().nullable(),
  confidence: z.number(),
});

const interestDraftSchema = z.object({
  draftKey: z.string().min(16).max(64),
  mode: z.enum(["APPLY", "SKIP"]),
  broker: z.enum(BROKERS),
  name: z.string().trim().min(1).max(160),
  currency: z.string().trim().min(3).max(8).nullable(),
  amount: z.number().nonnegative().nullable(),
  annualRatePct: z.number().min(0).max(100).nullable(),
  dailyIncome: z.number().nullable(),
  cumulativeIncome: z.number().nullable(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateSource: z.enum(["SCREEN", "UPLOAD_DATE"]),
  confidence: z.number().min(0).max(100),
  evidence: z.string().max(500).nullable(),
});

const dividendDraftSchema = z.object({
  draftKey: z.string().min(16).max(64),
  mode: z.enum(["APPLY", "SKIP"]),
  broker: z.enum(BROKERS),
  symbol: z.string().trim().max(24).nullable(),
  name: z.string().trim().min(1).max(160),
  currency: z.string().trim().min(3).max(8).nullable(),
  grossAmount: z.number().nonnegative().nullable(),
  taxAmount: z.number().nonnegative().nullable(),
  feeAmount: z.number().nonnegative().nullable(),
  netAmount: z.number().nonnegative().nullable(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  confidence: z.number().min(0).max(100),
  evidence: z.string().max(500).nullable(),
});

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function jstDate(value = new Date()) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function fxRateJpy(
  currency: string,
  settings: Awaited<ReturnType<typeof db.getSettings>>
) {
  const code = currency.toUpperCase();
  if (code === "JPY") return 1;
  if (code === "USD") return Number(settings.usdJpyRate);
  if (code === "SGD") return Number(settings.sgdJpyRate);
  if (code === "HKD") return Number(settings.hkdJpyRate);
  return null;
}

function imageMeta(dataUrl: string) {
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const buffer = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  const extension = mime.includes("png")
    ? "png"
    : mime.includes("webp")
      ? "webp"
      : "jpg";
  const digest = createHash("sha256").update(buffer).digest("hex");
  return { mime, buffer, extension, digest };
}

function storedCashDraftKeys(parsed: unknown, batchKey: string) {
  if (!parsed || typeof parsed !== "object") return null;
  const cashIncomeDraft = (parsed as Record<string, unknown>).cashIncomeDraft;
  if (!cashIncomeDraft || typeof cashIncomeDraft !== "object") return null;
  const draft = cashIncomeDraft as Record<string, unknown>;
  if (draft.batchKey !== batchKey) return null;
  const keys = new Set<string>();
  for (const group of [draft.interestAssets, draft.dividendIncomes]) {
    if (!Array.isArray(group)) continue;
    for (const row of group) {
      if (row && typeof row === "object") {
        const key = (row as Record<string, unknown>).draftKey;
        if (typeof key === "string") keys.add(key);
      }
    }
  }
  return keys;
}

export const importRouter = router({
  /** 対応している証券アプリのフォーマット一覧 */
  formats: protectedProcedure.query(() => BROKER_FORMAT_OPTIONS),

  /**
   * スクリーンショットを受け取り、S3 に保存して OCR 解析する。
   * 解析結果は importJobs に保持し、ユーザーの承認を待つ。
   */
  parseScreenshots: protectedProcedure
    .input(
      z.object({
        images: z
          .array(
            z.object({
              /** data:image/png;base64,.... 形式 */
              dataUrl: z.string().min(32),
              fileName: z.string().max(200).optional(),
            })
          )
          .min(1)
          .max(5),
        /** 証券アプリの種類。指定するとレイアウト定義を使って精度が上がる */
        // BROKER_FORMATS から生成し、対応アプリを追加したときの記述漏れを防ぐ
        formatId: z.enum(BROKER_FORMAT_IDS).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      for (const img of input.images) {
        if (!img.dataUrl.startsWith("data:image/")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "画像ファイルを指定してください",
          });
        }
        const base64 = img.dataUrl.split(",")[1] ?? "";
        if (Buffer.byteLength(base64, "base64") > MAX_IMAGE_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "画像サイズが大きすぎます（1枚 8MB まで）",
          });
        }
      }

      const preparedImages = input.images.map(image => ({
        fileName: image.fileName ?? null,
        ...imageMeta(image.dataUrl),
      }));
      const batchKey = createHash("sha256")
        .update(
          `${input.formatId ?? "generic"}:${preparedImages
            .map(image => image.digest)
            .sort()
            .join(":")}`
        )
        .digest("hex")
        .slice(0, 32);
      const evidence = await Promise.all(
        preparedImages.map(async (image, index) => {
          try {
            const stored = await storagePut(
              `${userId}-imports/${batchKey}-${index + 1}.${image.extension}`,
              image.buffer,
              image.mime
            );
            return {
              fileName: image.fileName,
              fileKey: stored.key,
              imageUrl: stored.url,
              digest: image.digest,
            };
          } catch (error) {
            console.warn(`[import] storage put failed for image ${index + 1}:`, error);
            return {
              fileName: image.fileName,
              fileKey: null,
              imageUrl: null,
              digest: image.digest,
            };
          }
        })
      );
      const fileKey = evidence[0]?.fileKey ?? undefined;
      const imageUrl = evidence[0]?.imageUrl ?? undefined;

      // 履歴用のジョブ作成に失敗しても、読み取り自体は続行できるようにする。
      // ここで例外を投げると、正しく読み取れていてもユーザーには失敗として見えてしまう。
      let jobId: number | null = null;
      try {
        jobId = await db.createImportJob({
          userId,
          fileKey,
          imageUrl,
          status: "PENDING",
        });
      } catch (error) {
        console.warn("[import] failed to create job record:", error);
      }

      /** ジョブが作れていた場合のみ履歴を更新する */
      const patchJob = async (
        patch: Parameters<typeof db.updateImportJob>[2]
      ) => {
        if (jobId === null) return;
        try {
          await db.updateImportJob(userId, jobId, patch);
        } catch (error) {
          console.warn("[import] failed to update job record:", error);
        }
      };

      try {
        const result = await extractPositions(
          input.images.map(i => i.dataUrl),
          input.formatId
        );

        if (
          result.positions.length === 0 &&
          result.interestAssets.length === 0 &&
          result.dividendIncomes.length === 0 &&
          result.account.netAssets === null &&
          result.account.cash === null
        ) {
          await patchJob({
            status: "FAILED",
            errorMessage: "対象データを読み取れませんでした",
            parsed: { result, evidence, batchKey },
          });
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message:
              "スクリーンショットから保有銘柄・現金宝・実際の配当入金を読み取れませんでした。文字と日付、通貨、金額が見える状態で撮影し直してください。",
          });
        }

        const [existing, existingAssets, snapshots] = await Promise.all([
          db.listHoldings(userId),
          db.listInterestAssets(userId),
          db.listInterestAssetIncomeSnapshots(userId),
        ]);
        const existingMap = new Map(existing.map(h => [h.symbol, h]));

        const rows = result.positions.map(p => {
          const { symbol, tickerCode, market } = normalizeSymbol(p.tickerCode);
          const prev = existingMap.get(symbol);
          return {
            ...p,
            symbol,
            tickerCode,
            market,
            mode: prev ? ("UPDATE" as const) : ("NEW" as const),
            existingQuantity: prev ? Number(prev.quantity) : null,
            existingAvgCost: prev ? Number(prev.avgCost) : null,
          };
        });
        const cashIncomeDraft = buildScreenshotCashIncomeDraft({
          batchKey,
          uploadDate: jstDate(),
          model: result.model,
          selectedFormatId: input.formatId ?? result.formatId,
          interestAssets: result.interestAssets,
          dividendIncomes: result.dividendIncomes,
          existingAssets,
          snapshots,
          evidence,
        });
        const warnings = [...result.warnings];
        if (
          jobId === null &&
          (cashIncomeDraft.interestAssets.length > 0 ||
            cashIncomeDraft.dividendIncomes.length > 0)
        ) {
          warnings.push(
            "取込履歴を保存できなかったため、キャッシュ収入は今回保存できません"
          );
        }

        await patchJob({
          status: "PARSED",
          parsed: {
            rows,
            warnings,
            cashIncomeDraft,
            evidence,
            rawCashIncome: {
              interestAssets: result.interestAssets,
              dividendIncomes: result.dividendIncomes,
            },
            model: result.model,
          },
          accountSummary: result.account,
        });

        return {
          jobId: jobId ?? undefined,
          rows,
          account: result.account,
          warnings,
          cashIncomeDraft,
          evidence,
          model: result.model,
          /** 実際に適用したフォーマット */
          formatId: result.formatId,
          /** 画面から推定した証券アプリ（選択が未指定だった場合の参考情報） */
          detectedFormatId: guessFormatFromBrokerName(result.account.broker),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "読み取りに失敗しました";
        await patchJob({ status: "FAILED", errorMessage: message });

        // 生のエラー文（412 Precondition Failed ...）ではユーザーが対処を判断できないため変換する
        const friendly = toFriendlyAiError(error, message);
        if (friendly.code === "TOO_MANY_REQUESTS") {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message:
              "AI の利用枠を使い切ったため読み取りできませんでした。時間をおいてから再度お試しください。急ぎの場合は保有銘柄ページの「銘柄を追加」から手入力できます。",
          });
        }
        throw friendly;
      }
    }),

  /**
   * ユーザーが確認・編集した行をデータベースへ反映する。
   */
  applyRows: protectedProcedure
    .input(
      z.object({
        jobId: z.number().int().positive().optional(),
        rows: z
          .array(
            rowSchema.extend({
              symbol: z.string().min(1).max(24),
              /*
               * 市場の選択肢は MARKETS から生成する。ここにハードコードすると
               * 市場を追加したとき（SG を足したときのように）更新漏れが起き、
               * 取込だけが失敗する。
               */
              market: z.enum(MARKETS as unknown as [Market, ...Market[]]),
              mode: z.enum(["NEW", "UPDATE", "SKIP"]),
            })
          )
          .default([]),
        batchKey: z.string().min(16).max(64).optional(),
        interestAssets: z.array(interestDraftSchema).max(50).default([]),
        dividendIncomes: z.array(dividendDraftSchema).max(200).default([]),
        cashBalance: z.number().min(0).nullable().optional(),
        /** 取込元の証券アプリ。銘柄に紐づけて口座別の集計に使う */
        formatId: z.enum(BROKER_FORMAT_IDS).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const broker = brokerFromFormatId(input.formatId);
      let created = 0;
      let updated = 0;
      const skipped: string[] = [];

      const hasCashDrafts =
        input.interestAssets.length > 0 || input.dividendIncomes.length > 0;
      let allowedCashDraftKeys: Set<string> | null = null;
      if (hasCashDrafts) {
        if (!input.jobId || !input.batchKey) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "キャッシュ収入の保存には取込履歴が必要です",
          });
        }
        const importJob = await db.getImportJob(userId, input.jobId);
        if (
          !importJob ||
          (importJob.status !== "PARSED" && importJob.status !== "APPLIED")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "確認できる取込草稿が見つかりません",
          });
        }
        allowedCashDraftKeys = storedCashDraftKeys(
          importJob.parsed,
          input.batchKey
        );
        const requestedKeys = [
          ...input.interestAssets,
          ...input.dividendIncomes,
        ].map(row => row.draftKey);
        if (
          !allowedCashDraftKeys ||
          requestedKeys.some(key => !allowedCashDraftKeys?.has(key))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "取込草稿と一致しない収入行が含まれています",
          });
        }
      }

      for (const row of input.rows) {
        if (row.mode === "SKIP") continue;
        if (
          row.quantity === null ||
          row.quantity <= 0 ||
          row.avgCost === null
        ) {
          skipped.push(`${row.name}（株数または取得単価が未入力）`);
          continue;
        }

        const quote = await fetchQuote(row.symbol);
        // 同一銘柄を複数口座で保有できるため、口座まで一致した行だけを更新対象にする。
        // シンボルだけで引くと、別口座の保有を上書きして株数が消えてしまう。
        const existing = await db.getHoldingBySymbolAndBroker(
          userId,
          row.symbol,
          broker
        );

        const priceFields = {
          currentPrice:
            quote?.price !== null && quote?.price !== undefined
              ? String(quote.price)
              : row.currentPrice !== null
                ? String(row.currentPrice)
                : undefined,
          previousClose:
            quote?.previousClose !== null && quote?.previousClose !== undefined
              ? String(quote.previousClose)
              : undefined,
          fiftyTwoWeekHigh:
            quote?.fiftyTwoWeekHigh !== null &&
            quote?.fiftyTwoWeekHigh !== undefined
              ? String(quote.fiftyTwoWeekHigh)
              : undefined,
          fiftyTwoWeekLow:
            quote?.fiftyTwoWeekLow !== null &&
            quote?.fiftyTwoWeekLow !== undefined
              ? String(quote.fiftyTwoWeekLow)
              : undefined,
          priceUpdatedAt: new Date(),
        };

        if (existing) {
          await db.updateHolding(userId, existing.id, {
            name: row.name,
            quantity: String(row.quantity),
            avgCost: String(row.avgCost),
            currency: quote?.currency ?? existing.currency,
            broker,
            ...priceFields,
          });
          updated += 1;
        } else {
          const profile = await fetchCompanyProfile(row.symbol);
          await db.insertHolding({
            userId,
            symbol: row.symbol,
            tickerCode: row.tickerCode,
            name: row.name,
            market: row.market,
            // 株価 API が通貨を返さない場合は市場から推定する（SG なら SGD）
            currency: quote?.currency ?? MARKET_CURRENCY[row.market],
            broker,
            quantity: String(row.quantity),
            avgCost: String(row.avgCost),
            sector: profile?.sector ?? undefined,
            industry: profile?.industry ?? undefined,
            website: profile?.website ?? undefined,
            businessSummary: profile?.businessSummary ?? undefined,
            profileUpdatedAt: profile ? new Date() : undefined,
            ...priceFields,
          });
          created += 1;
        }
      }

      if (input.cashBalance !== null && input.cashBalance !== undefined) {
        await db.updateSettings(userId, {
          cashBalance: String(input.cashBalance),
        });
      }

      const cashIncomeResult = {
        interestAssetsSaved: 0,
        interestIncomeRecordsSaved: 0,
        dividendRecordsSaved: 0,
        skipped: [] as string[],
      };
      if (hasCashDrafts && input.batchKey) {
        const [settings, existingAssets, existingSnapshots] = await Promise.all([
          db.getSettings(userId),
          db.listInterestAssets(userId),
          db.listInterestAssetIncomeSnapshots(userId),
        ]);

        for (const row of input.interestAssets) {
          if (row.mode === "SKIP") continue;
          if (!row.currency || row.amount === null) {
            cashIncomeResult.skipped.push(
              `${row.name}（通貨または現在残高が未取得）`
            );
            continue;
          }
          const currency = row.currency.toUpperCase();
          const fx = fxRateJpy(currency, settings);
          const matchingAsset = existingAssets.find(
            asset =>
              asset.broker === row.broker &&
              asset.name.trim().toLowerCase() === row.name.trim().toLowerCase() &&
              asset.currency.toUpperCase() === currency
          );
          const previous = findPreviousCumulativeIncome(
            existingSnapshots,
            matchingAsset ?? null,
            row.broker,
            row.name,
            currency,
            row.asOfDate
          );
          const capturedAt = new Date();
          const interestAssetId = await db.upsertInterestAsset({
            userId,
            broker: row.broker,
            name: row.name,
            currency,
            amount: String(row.amount),
            annualRatePct:
              row.annualRatePct === null ? null : String(row.annualRatePct),
            dailyIncome: row.dailyIncome === null ? null : String(row.dailyIncome),
            cumulativeIncome:
              row.cumulativeIncome === null
                ? null
                : String(row.cumulativeIncome),
            compounding: true,
            capturedAt,
            notes: [
              "月次スクリーンショットから確認保存",
              row.evidence,
              row.dateSource === "UPLOAD_DATE"
                ? "基準日はアップロード日を確認して採用"
                : null,
            ]
              .filter(Boolean)
              .join(" / "),
          });
          if (interestAssetId <= 0) {
            cashIncomeResult.skipped.push(`${row.name}（保存先を確認できません）`);
            continue;
          }
          await db.upsertInterestAssetIncomeSnapshot({
            userId,
            interestAssetId,
            broker: row.broker,
            name: row.name,
            currency,
            incomeDate: row.asOfDate,
            amount: String(row.amount),
            annualRatePct:
              row.annualRatePct === null ? null : String(row.annualRatePct),
            dailyIncome: row.dailyIncome === null ? null : String(row.dailyIncome),
            cumulativeIncome:
              row.cumulativeIncome === null
                ? null
                : String(row.cumulativeIncome),
            fxRateJpy: fx === null ? null : String(fx),
            source: "SCREENSHOT_CONFIRMED",
            capturedAt,
          });
          cashIncomeResult.interestAssetsSaved += 1;

          const delta = calculateCumulativeIncomeDelta({
            currentCumulativeIncome: row.cumulativeIncome,
            currentAsOfDate: row.asOfDate,
            previousCumulativeIncome: previous?.cumulativeIncome ?? null,
            previousAsOfDate: previous?.asOfDate ?? null,
          });
          if (delta.status === "READY" && delta.amount !== null && delta.amount > 0) {
            await db.insertCashIncomeRecord({
              userId,
              kind: "INTEREST",
              status: "SETTLED",
              occurredOn: row.asOfDate,
              broker: row.broker,
              symbol: null,
              name: `${row.name} 前回スクショ以降の利息`,
              currency,
              grossAmount: null,
              taxAmount: null,
              feeAmount: null,
              netAmount: String(delta.amount),
              fxRateJpy: fx === null ? null : String(fx),
              source: "SCREENSHOT_CUMULATIVE_DELTA",
              sourceReference: `import-job:${input.jobId}:interest:${row.draftKey}`,
              dedupeKey: `screenshot:${input.batchKey}:interest:${row.draftKey}`,
              notes: `${previous?.asOfDate}→${row.asOfDate}の累計収益差額。日次利息とは重複加算しない。`,
            });
            cashIncomeResult.interestIncomeRecordsSaved += 1;
          } else if (delta.status === "BLOCKED") {
            cashIncomeResult.skipped.push(
              `${row.name}（累計収益または基準日の逆行を検出したため差額収入は未保存）`
            );
          }
        }

        for (const row of input.dividendIncomes) {
          if (row.mode === "SKIP") continue;
          if (!row.currency || !row.occurredOn) {
            cashIncomeResult.skipped.push(
              `${row.name}（通貨または実際の入金日が未取得）`
            );
            continue;
          }
          const currency = row.currency.toUpperCase();
          const allDeductionsKnown =
            row.taxAmount !== null && row.feeAmount !== null;
          const netAmount =
            row.netAmount ??
            (row.grossAmount !== null && allDeductionsKnown
              ? row.grossAmount - (row.taxAmount ?? 0) - (row.feeAmount ?? 0)
              : null);
          if (netAmount === null || netAmount < 0) {
            cashIncomeResult.skipped.push(
              `${row.name}（実際の入金額を確認できません）`
            );
            continue;
          }
          if (
            row.netAmount !== null &&
            row.grossAmount !== null &&
            allDeductionsKnown &&
            Math.abs(
              row.netAmount -
                (row.grossAmount -
                  (row.taxAmount ?? 0) -
                  (row.feeAmount ?? 0))
            ) > Math.max(0.01, row.netAmount * 0.001)
          ) {
            cashIncomeResult.skipped.push(
              `${row.name}（税前額・税・手数料と入金額が一致しません）`
            );
            continue;
          }
          const fx = fxRateJpy(currency, settings);
          if (fx === null || !Number.isFinite(fx)) {
            cashIncomeResult.skipped.push(
              `${row.name}（${currency}のJPY換算レートが未取得）`
            );
            continue;
          }
          await db.insertCashIncomeRecord({
            userId,
            kind: "DIVIDEND",
            status: "SETTLED",
            occurredOn: row.occurredOn,
            broker: row.broker,
            symbol: row.symbol ? normalizeSymbol(row.symbol).symbol : null,
            name: row.name,
            currency,
            grossAmount:
              row.grossAmount === null ? null : String(row.grossAmount),
            taxAmount: row.taxAmount === null ? null : String(row.taxAmount),
            feeAmount: row.feeAmount === null ? null : String(row.feeAmount),
            netAmount: String(netAmount),
            fxRateJpy: String(fx),
            source: "SCREENSHOT_CONFIRMED",
            sourceReference: `import-job:${input.jobId}:dividend:${row.draftKey}`,
            dedupeKey: `screenshot:${input.batchKey}:dividend:${row.draftKey}`,
            notes: [
              row.evidence,
              row.grossAmount === null ? "税前額はスクショ未表示" : null,
            ]
              .filter(Boolean)
              .join(" / "),
          });
          cashIncomeResult.dividendRecordsSaved += 1;
        }
      }

      if (input.jobId) {
        await db.updateImportJob(userId, input.jobId, {
          status: "APPLIED",
          appliedCount:
            created +
            updated +
            cashIncomeResult.interestAssetsSaved +
            cashIncomeResult.dividendRecordsSaved,
        });
      }

      /*
       * 取り込みで株数が変わったので、相談で出した提案が実行されたかを
       * ここで判定する。別操作にすると判定を忘れた分だけ「実行したのに
       * 記録されていない」提案が溜まり、AI の当否を検証できなくなる。
       * 判定の失敗で取り込みまで失敗扱いにはしない（取り込みは成功している）。
       */
      let executionCheck: Awaited<ReturnType<typeof checkExecutions>> | null =
        null;
      try {
        executionCheck = await checkExecutions(userId);
      } catch (e) {
        console.error("[applyRows] 提案の実行判定に失敗", e);
      }

      let actionQueueCheck: Awaited<
        ReturnType<typeof reconcileApprovedActionQueue>
      > | null = null;
      try {
        actionQueueCheck = await reconcileApprovedActionQueue(userId);
      } catch (e) {
        console.error("[applyRows] アクション待ちの実行判定に失敗", e);
      }

      /*
       * 取り込みが終わった時点の保有状態を「その月の記録」として残す。
       *
       * 保有テーブルは今の状態しか持たないため、翌月に取り込むと前月が
       * 上書きされて消える。売った銘柄は行ごと消え、買い増した銘柄は株数が
       * 置き換わるので、後から「資産が増えたのは値上がりか買い増しか」を
       * 判断できない。取り込みと同時に記録するのは、別操作にすると
       * 記録し忘れた月だけ推移が飛んで比較が成立しなくなるため。
       *
       * 記録の失敗で取り込みまで失敗扱いにはしない（取り込み自体は成功済み）。
       */
      let snapshot: Awaited<ReturnType<typeof saveMonthlySnapshot>> | null =
        null;
      try {
        snapshot = await saveMonthlySnapshot(userId, { source: "import" });
      } catch (e) {
        console.error("[applyRows] 月次記録の保存に失敗", e);
      }

      return {
        created,
        updated,
        skipped,
        cashIncomeResult,
        executionCheck,
        actionQueueCheck,
        snapshot,
      } as const;
    }),

  history: protectedProcedure.query(async ({ ctx }) =>
    db.listImportJobs(ctx.user.id, 12)
  ),

  /** 記録された月の一覧（新しい順） */
  monthlyList: protectedProcedure.query(async ({ ctx }) =>
    listMonthlySnapshots(ctx.user.id, 24)
  ),

  /**
   * 2 つの月を比べる。月を指定しない場合は直近の 2 件を比べる。
   * 比較相手は「1 つ前に記録がある月」を使う（記録を飛ばした月があっても成立させる）。
   */
  monthlyCompare: protectedProcedure
    .input(
      z
        .object({
          toPeriod: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
          fromPeriod: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.toPeriod) {
        return compareMonths(ctx.user.id, input.toPeriod, input.fromPeriod);
      }
      return compareLatestMonths(ctx.user.id);
    }),

  /**
   * 今の保有状態を指定月の記録として保存する。
   *
   * 取り込み時に自動で記録されるが、過去分をさかのぼって作る場合や
   * 取り込みを伴わずに月末の状態を残したい場合に使う。
   */
  monthlySave: protectedProcedure
    .input(
      z.object({
        periodYm: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      saveMonthlySnapshot(ctx.user.id, {
        periodYm: input.periodYm,
        source: "manual",
        note: input.note,
      })
    ),

  /** 誤って作った月の記録を削除する */
  monthlyDelete: protectedProcedure
    .input(z.object({ periodYm: z.string().regex(/^\d{4}-\d{2}$/) }))
    .mutation(async ({ ctx, input }) => {
      const removed = await deleteMonthlySnapshot(ctx.user.id, input.periodYm);
      return { removed };
    }),
});

export type ImportedRow = ParsedPosition & {
  symbol: string;
  market: Market;
  mode: "NEW" | "UPDATE" | "SKIP";
  existingQuantity: number | null;
  existingAvgCost: number | null;
};
