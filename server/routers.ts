import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { importRouter } from "./routers/importRouter";
import { newsRouter } from "./routers/newsRouter";
import { portfolioRouter } from "./routers/portfolio";
import { watchlistRouter } from "./routers/watchlistRouter";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  portfolio: portfolioRouter,
  news: newsRouter,
  watchlist: watchlistRouter,
  import: importRouter,
});

export type AppRouter = typeof appRouter;

