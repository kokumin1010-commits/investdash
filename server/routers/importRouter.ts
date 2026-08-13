import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { storagePut } from "../storage";
import { extractPositions, type ParsedPosition } from "../services/ocr";
import { fetchCompanyProfile, fetchQuote } from "../services/marketData";
import { normalizeSymbol } from "../../shared/investing";

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

      const jobId = await db.createImportJob({ userId, fileKey, imageUrl, status: "PENDING" });

      try {
        const result = await extractPositions(input.images.map(i => i.dataUrl));

        if (result.positions.length === 0) {
          await db.updateImportJob(userId, jobId, {
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

        await db.updateImportJob(userId, jobId, {
          status: "PARSED",
          parsed: { rows, warnings: result.warnings },
          accountSummary: result.account,
        });

        return {
          jobId,
          rows,
          account: result.account,
          warnings: result.warnings,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message = error instanceof Error ? error.message : "読み取りに失敗しました";
        await db.updateImportJob(userId, jobId, { status: "FAILED", errorMessage: message });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
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
              market: z.enum(["JP", "US", "OTHER"]),
              mode: z.enum(["NEW", "UPDATE", "SKIP"]),
            })
          )
          .min(1),
        cashBalance: z.number().min(0).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
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
        const existing = await db.getHoldingBySymbol(userId, row.symbol);

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
            currency: quote?.currency ?? (row.market === "JP" ? "JPY" : "USD"),
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

      return { created, updated, skipped } as const;
    }),

  history: protectedProcedure.query(async ({ ctx }) => db.listImportJobs(ctx.user.id, 12)),
});

export type ImportedRow = ParsedPosition & {
  symbol: string;
  market: "JP" | "US" | "OTHER";
  mode: "NEW" | "UPDATE" | "SKIP";
  existingQuantity: number | null;
  existingAvgCost: number | null;
};
