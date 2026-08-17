import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { checkExecutions } from "../services/outcomeService";
import { storagePut } from "../storage";
import { extractPositions, type ParsedPosition } from "../services/ocr";
import {
  BROKER_FORMAT_IDS,
  BROKER_FORMAT_OPTIONS,
  guessFormatFromBrokerName,
} from "../services/brokerFormats";
import { toFriendlyAiError } from "../services/aiErrors";
import { fetchCompanyProfile, fetchQuote } from "../services/marketData";
import {
  brokerFromFormatId,
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

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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
          throw new TRPCError({ code: "BAD_REQUEST", message: "画像ファイルを指定してください" });
        }
        const base64 = img.dataUrl.split(",")[1] ?? "";
        if (Buffer.byteLength(base64, "base64") > MAX_IMAGE_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "画像サイズが大きすぎます（1枚 8MB まで）",
          });
        }
      }

      // 1 枚目を保存して履歴に残す
      let fileKey: string | undefined;
      let imageUrl: string | undefined;
      try {
        const first = input.images[0];
        const mime = first.dataUrl.slice(5, first.dataUrl.indexOf(";"));
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        const buffer = Buffer.from(first.dataUrl.split(",")[1] ?? "", "base64");
        const stored = await storagePut(
          `${userId}-imports/${Date.now()}.${ext}`,
          buffer,
          mime
        );
        fileKey = stored.key;
        imageUrl = stored.url;
      } catch (error) {
        console.warn("[import] storage put failed:", error);
      }

      // 履歴用のジョブ作成に失敗しても、読み取り自体は続行できるようにする。
      // ここで例外を投げると、正しく読み取れていてもユーザーには失敗として見えてしまう。
      let jobId: number | null = null;
      try {
        jobId = await db.createImportJob({ userId, fileKey, imageUrl, status: "PENDING" });
      } catch (error) {
        console.warn("[import] failed to create job record:", error);
      }

      /** ジョブが作れていた場合のみ履歴を更新する */
      const patchJob = async (patch: Parameters<typeof db.updateImportJob>[2]) => {
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

        if (result.positions.length === 0) {
          await patchJob({
            status: "FAILED",
            errorMessage: "保有銘柄を読み取れませんでした",
            parsed: result,
          });
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message:
              "スクリーンショットから保有銘柄を読み取れませんでした。保有一覧が表示された画面で、文字がはっきり見える状態で撮影し直してください。",
          });
        }

        // 既存保有と突き合わせて新規／更新を判定
        const existing = await db.listHoldings(userId);
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

        await patchJob({
          status: "PARSED",
          parsed: { rows, warnings: result.warnings },
          accountSummary: result.account,
        });

        return {
          jobId: jobId ?? undefined,
          rows,
          account: result.account,
          warnings: result.warnings,
          /** 実際に適用したフォーマット */
          formatId: result.formatId,
          /** 画面から推定した証券アプリ（選択が未指定だった場合の参考情報） */
          detectedFormatId: guessFormatFromBrokerName(result.account.broker),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message = error instanceof Error ? error.message : "読み取りに失敗しました";
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
          .min(1),
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

      for (const row of input.rows) {
        if (row.mode === "SKIP") continue;
        if (row.quantity === null || row.quantity <= 0 || row.avgCost === null) {
          skipped.push(`${row.name}（株数または取得単価が未入力）`);
          continue;
        }

        const quote = await fetchQuote(row.symbol);
        // 同一銘柄を複数口座で保有できるため、口座まで一致した行だけを更新対象にする。
        // シンボルだけで引くと、別口座の保有を上書きして株数が消えてしまう。
        const existing = await db.getHoldingBySymbolAndBroker(userId, row.symbol, broker);

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
            quote?.fiftyTwoWeekHigh !== null && quote?.fiftyTwoWeekHigh !== undefined
              ? String(quote.fiftyTwoWeekHigh)
              : undefined,
          fiftyTwoWeekLow:
            quote?.fiftyTwoWeekLow !== null && quote?.fiftyTwoWeekLow !== undefined
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
        await db.updateSettings(userId, { cashBalance: String(input.cashBalance) });
      }

      if (input.jobId) {
        await db.updateImportJob(userId, input.jobId, {
          status: "APPLIED",
          appliedCount: created + updated,
        });
      }

      /*
       * 取り込みで株数が変わったので、相談で出した提案が実行されたかを
       * ここで判定する。別操作にすると判定を忘れた分だけ「実行したのに
       * 記録されていない」提案が溜まり、AI の当否を検証できなくなる。
       * 判定の失敗で取り込みまで失敗扱いにはしない（取り込みは成功している）。
       */
      let executionCheck: Awaited<ReturnType<typeof checkExecutions>> | null = null;
      try {
        executionCheck = await checkExecutions(userId);
      } catch (e) {
        console.error("[applyRows] 提案の実行判定に失敗", e);
      }

      return { created, updated, skipped, executionCheck } as const;
    }),

  history: protectedProcedure.query(async ({ ctx }) => db.listImportJobs(ctx.user.id, 12)),
});

export type ImportedRow = ParsedPosition & {
  symbol: string;
  market: Market;
  mode: "NEW" | "UPDATE" | "SKIP";
  existingQuantity: number | null;
  existingAvgCost: number | null;
};
