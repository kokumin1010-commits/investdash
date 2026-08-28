import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { BROKERS, normalizeSymbol } from "../../shared/investing";
import {
  fetchCompanyProfile,
  fetchDividendHistory,
  fetchPriceHistory,
  fetchQuote,
} from "../services/marketData";
import { regenerateWatchSignal } from "../services/portfolio";
import { summarizeDividends } from "../services/dividend";
import { computeTargetDistance, targetDistanceNote } from "../../shared/targetDistance";
import { heldPnlPct, mergeHeldPositions } from "../../shared/heldMerge";
import {
  reviseTarget,
  TARGET_REVISE_MODEL,
  type TargetReviseContext,
} from "../services/targetReviser";
import { withAiRunLog } from "../services/aiRunLog";
import { toFriendlyAiError } from "../services/aiErrors";
import {
  generateWatchProposalDraft,
  listLatestWatchProposals,
  reviewWatchProposal,
} from "../services/watchProposalService";

export const watchlistRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const [items, signalMap, news, holdings] = await Promise.all([
      db.listWatchlist(ctx.user.id),
      db.latestSignals(ctx.user.id),
      db.listNews(ctx.user.id, { limit: 400 }),
      db.listHoldings(ctx.user.id),
    ]);

    const newsCount = new Map<string, number>();
    news.forEach(x => newsCount.set(x.symbol, (newsCount.get(x.symbol) ?? 0) + 1));

    /*
     * 既に保有している銘柄がウォッチリストに残っていることがある。
     * AI の候補提案から一括で登録した場合や、買った後に外し忘れた場合。
     * 「まだ持っていない」前提で目標価格を見ていると、実際には保有済みで
     * 買い増しの判断をすべき銘柄を新規購入として扱ってしまう。
     *
     * 畳み込みは shared の共通関数に任せる。買い増しプラン一覧でも
     * 同じ突き合わせをするため、式を 2 か所に書くとずれる。
     */
    const heldMap = mergeHeldPositions(
      holdings.map(h => ({
        symbol: h.symbol,
        quantity: Number(h.quantity),
        avgCost: Number(h.avgCost),
        broker: h.broker,
      }))
    );
    const latestProposals = await listLatestWatchProposals(
      ctx.user.id,
      items.map(item => item.id)
    );

    return items.map(w => {
      const price = w.currentPrice ? Number(w.currentPrice) : null;
      const target = w.targetPrice ? Number(w.targetPrice) : null;
      const prev = w.previousClose ? Number(w.previousClose) : null;
      const sig = signalMap.get(w.symbol);
      const held = heldMap.get(w.symbol) ?? null;
      const heldAvgCost = held ? held.avgCost : null;
      /*
       * 目標価格が現在値からどれだけ離れているかは shared の判定に任せる。
       * 画面側で式を書くと、買い増しプラン一覧の判定（同じ閾値を使う）と
       * ずれたときに「警告は出るのに作り直しても直らない」状態になる。
       */
      const distance = computeTargetDistance(price, target);
      return {
        ...w,
        priceNum: price,
        targetNum: target,
        /**
         * 現在値から見て、買いたい値段まであと何 % 動く必要があるか。
         * 負なら「あと N% 下がれば届く」、正なら「すでに目標より安い」。
         *
         * 分母は現在値。目標価格を分母にすると、たとえば現在 3,751 / 目標 1,900 で
         * 97.4% という数字になり「あと 49.4% 下がれば届く」という実感と大きく食い違う。
         * 候補提案側（candidateService）も現在値基準なので、画面内で基準を揃える。
         */
        gapPct: distance.gapPct,
        /** 目標価格の距離の区分（遠すぎる／やや遠い／現実的など） */
        targetLevel: distance.level,
        /** 作り直しを検討すべきか */
        targetNeedsRework: distance.needsRework,
        /** なぜ作り直すべきかの説明。問題なければ null */
        targetNote: targetDistanceNote(distance),
        reachedTarget: price !== null && target !== null ? price <= target : false,
        dayChangePct: price !== null && prev !== null && prev !== 0 ? ((price - prev) / prev) * 100 : null,
        signal: sig && sig.scope === "WATCHLIST"
          ? {
              action: sig.action,
              confidence: sig.confidence,
              rationale: sig.rationale,
              createdAt: sig.createdAt,
            }
          : null,
        newsCount: newsCount.get(w.symbol) ?? 0,
        /**
         * 既に保有しているか。保有済みなら「新規に買うか」ではなく
         * 「買い増すか」の判断になるため、画面で区別できるようにする。
         */
        alreadyHeld: held !== null,
        heldQuantity: held?.quantity ?? null,
        heldAvgCost,
        heldBrokers: held ? held.brokers : [],
        /**
         * 保有している場合の損益率（%）。取得原価が 0 以下の銘柄では
         * 率に意味がないため null を返す。
         */
        heldPnlPct: heldPnlPct(heldAvgCost, price),
        /** AI が生成済みでも、本人が確認するまでは計画欄へ反映しない */
        pendingProposal:
          latestProposals.get(w.id)?.reviewStatus === "PENDING"
            ? latestProposals.get(w.id) ?? null
            : null,
        latestProposal: latestProposals.get(w.id) ?? null,
      };
    });
  }),

  add: protectedProcedure
    .input(
      z.object({
        code: z.string().min(1).max(24),
        name: z.string().max(160).optional(),
        targetPrice: z.number().min(0).nullable().optional(),
        buyConditions: z.string().max(4000).optional(),
        watchReason: z.string().max(4000).optional(),
        plannedAmount: z.number().min(0).nullable().optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { symbol, tickerCode, market } = normalizeSymbol(input.code);
      if (!symbol) throw new TRPCError({ code: "BAD_REQUEST", message: "銘柄コードが不正です" });

      const existing = await db.getWatchBySymbol(ctx.user.id, symbol);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `${symbol} は既にウォッチリストにあります` });
      }

      const quote = await fetchQuote(symbol);
      if (!quote || quote.price === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.code} の相場情報が見つかりませんでした。コードをご確認ください。`,
        });
      }
      const profile = await fetchCompanyProfile(symbol);

      const id = await db.insertWatchItem({
        userId: ctx.user.id,
        symbol,
        tickerCode,
        name: input.name || quote.longName || quote.shortName || tickerCode,
        market,
        currency: quote.currency,
        currentPrice: String(quote.price),
        previousClose: quote.previousClose !== null ? String(quote.previousClose) : undefined,
        targetPrice:
          input.targetPrice === null || input.targetPrice === undefined
            ? null
            : String(input.targetPrice),
        buyConditions: input.buyConditions,
        watchReason: input.watchReason,
        plannedAmount:
          input.plannedAmount === null || input.plannedAmount === undefined
            ? null
            : String(input.plannedAmount),
        priority: input.priority,
        sector: profile?.sector ?? undefined,
        industry: profile?.industry ?? undefined,
        priceUpdatedAt: new Date(),
      });

      return { id, symbol } as const;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(160).optional(),
        targetPrice: z.number().min(0).nullable().optional(),
        buyConditions: z.string().max(4000).optional(),
        watchReason: z.string().max(4000).optional(),
        plannedAmount: z.number().min(0).nullable().optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await db.getWatchItem(ctx.user.id, input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      await db.updateWatchItem(ctx.user.id, input.id, {
        name: input.name,
        targetPrice:
          input.targetPrice === undefined
            ? undefined
            : input.targetPrice === null
              ? null
              : String(input.targetPrice),
        buyConditions: input.buyConditions,
        watchReason: input.watchReason,
        plannedAmount:
          input.plannedAmount === undefined
            ? undefined
            : input.plannedAmount === null
              ? null
              : String(input.plannedAmount),
        priority: input.priority,
      });
      return { success: true } as const;
    }),

  /**
   * 先に保存した watch item について最新データを集め、AI 提案を下書き保存する。
   * この操作だけでは targetPrice 等を変更しない。
   */
  generateProposal: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => generateWatchProposalDraft(ctx.user.id, input.id)),

  /** ユーザーが確認した場合だけ AI 提案を watchlist の計画欄へ反映する */
  reviewProposal: protectedProcedure
    .input(
      z.object({
        proposalId: z.number().int().positive(),
        decision: z.enum(["ACCEPT", "EDIT", "REJECT"]),
        targetPrice: z.number().min(0).nullable().optional(),
        plannedAmount: z.number().min(0).nullable().optional(),
        watchReason: z.string().max(4000).optional(),
        buyConditions: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => reviewWatchProposal(ctx.user.id, input)),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await db.deleteWatchItem(ctx.user.id, input.id);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
      return { success: true, deletedProposals: removed.deletedProposals } as const;
    }),

  /**
   * 買いたい値段を AI に作り直させる。
   *
   * 目標が現在値から離れすぎている（-30% 超）銘柄は、待っていても買えない
   * まま機会を逃す。実測では INPEX が現在値 3,765 円に対し目標 1,900 円
   * （-49.5%）で、半値になるのを待つ設定になっていた。現実的に届く水準へ
   * 引き直す。
   *
   * 根拠も一緒に保存する。値段だけ書き換えると「なぜこの値段か」が
   * 分からず、次に見たときにまた疑うことになる。
   */
  reviseTarget: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const item = await db.getWatchItem(ctx.user.id, input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      const currentPrice = item.currentPrice === null ? null : Number(item.currentPrice);
      if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
        /*
         * 現在値がないと「現実的に届く水準」を決められない。
         * 適当な値を置くと根拠のない目標価格が残るため、ここで止める。
         */
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${item.name} の現在値が取得できていません。株価を更新してからお試しください。`,
        });
      }

      const previousTarget = item.targetPrice === null ? null : Number(item.targetPrice);

      const [history, dividends, news] = await Promise.all([
        fetchPriceHistory(item.symbol, "6mo", "1d"),
        fetchDividendHistory(item.symbol),
        db.listNews(ctx.user.id, { symbol: item.symbol, limit: 8 }),
      ]);

      const closes = history.map(h => h.c).filter(c => Number.isFinite(c) && c > 0);
      const returnOver = (days: number): number | null => {
        if (history.length < 2) return null;
        const last = history[history.length - 1];
        const cutoff = last.t - days * 24 * 60 * 60 * 1000;
        const base = history.find(b => b.t >= cutoff);
        if (!base || base.c === 0) return null;
        return ((last.c - base.c) / base.c) * 100;
      };

      /*
       * 配当はウォッチリストのテーブルに持っていないため都度取得する。
       * 利回りを根拠に使えると、株価の水準ではなく受け取れる金額から
       * 買いたい値段を決められる（REIT や商社では実際にこれが基準になる）。
       */
      const annual = dividends
        ? summarizeDividends(dividends.dividends, dividends.splits, new Date()).annualDividend
        : null;

      const reviseCtx: TargetReviseContext = {
        symbol: item.symbol,
        name: item.name,
        currency: item.currency,
        sector: item.sector,
        industry: item.industry,
        currentPrice,
        previousTarget,
        rangeHigh: closes.length > 0 ? Math.max(...closes) : null,
        rangeLow: closes.length > 0 ? Math.min(...closes) : null,
        return1mPct: returnOver(30),
        return3mPct: returnOver(90),
        annualDividend: annual !== null && annual > 0 ? annual : null,
        watchReason: item.watchReason,
        news: news.map(n => ({
          title: n.title,
          summary: n.summary,
          impactScore: n.impactScore,
        })),
      };

      let revised: Awaited<ReturnType<typeof reviseTarget>>;
      try {
        revised = await withAiRunLog(
          {
            userId: ctx.user.id,
            kind: "target_revise",
            symbol: item.symbol,
            model: TARGET_REVISE_MODEL,
            summarize: r =>
              `${previousTarget ?? "未設定"} → ${r.targetPrice} ${item.currency}: ${r.basis.slice(0, 80)}`,
          },
          () => reviseTarget(reviseCtx)
        );
      } catch (error) {
        // 利用枠切れなどは原因と対処が分かる文言に変換する
        throw toFriendlyAiError(error, "買いたい値段の見直しに失敗しました");
      }

      /*
       * 根拠は買付条件に追記する。上書きにすると本人が書いた条件が消える。
       * 日付を付けて時系列で読めるようにする。
       */
      const stamp = new Date().toLocaleDateString("ja-JP");
      const appended = [
        item.buyConditions?.trim() || null,
        `【${stamp} AI が見直し】${revised.basis}`,
        revised.buyConditions,
      ]
        .filter(Boolean)
        .join("\n");

      await db.updateWatchItem(ctx.user.id, input.id, {
        targetPrice: String(revised.targetPrice),
        buyConditions: appended.slice(0, 4000),
      });

      const distance = computeTargetDistance(currentPrice, revised.targetPrice);
      return {
        symbol: item.symbol,
        name: item.name,
        currency: item.currency,
        previousTarget,
        targetPrice: revised.targetPrice,
        gapPct: distance.gapPct,
        level: distance.level,
        basis: revised.basis,
        buyConditions: revised.buyConditions,
        note: revised.note || null,
        adjustedNote: revised.adjustedNote,
      } as const;
    }),

  /** ウォッチリスト銘柄を保有ポジションへ昇格 */
  promote: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        quantity: z.number().positive(),
        avgCost: z.number().min(0),
        broker: z.enum(BROKERS).optional(),
        keepInWatchlist: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const item = await db.getWatchItem(ctx.user.id, input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      // 同一銘柄でも証券口座が違えば別ポジションになるため、口座まで見て判定する
      const broker = input.broker ?? "other";
      const existing = await db.getHoldingBySymbolAndBroker(ctx.user.id, item.symbol, broker);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "この銘柄は同じ証券口座の保有一覧に既にあります",
        });
      }

      const holdingId = await db.insertHolding({
        userId: ctx.user.id,
        symbol: item.symbol,
        tickerCode: item.tickerCode,
        name: item.name,
        market: item.market,
        currency: item.currency,
        broker,
        quantity: String(input.quantity),
        avgCost: String(input.avgCost),
        currentPrice: item.currentPrice ?? undefined,
        previousClose: item.previousClose ?? undefined,
        sector: item.sector ?? undefined,
        industry: item.industry ?? undefined,
        priceUpdatedAt: new Date(),
      });

      // ウォッチリストの記録を投資カードへ引き継ぐ
      if (item.watchReason || item.buyConditions) {
        await db.upsertCard({
          userId: ctx.user.id,
          symbol: item.symbol,
          holdingId,
          buyReason: item.watchReason ?? undefined,
          coreThesis: item.buyConditions ?? undefined,
        });
      }

      if (!input.keepInWatchlist) {
        await db.deleteWatchItem(ctx.user.id, input.id);
      }

      return { holdingId } as const;
    }),

  regenerateSignal: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const item = await db.getWatchItem(ctx.user.id, input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
      return regenerateWatchSignal(ctx.user.id, item);
    }),
});
