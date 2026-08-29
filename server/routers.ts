import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { authRouter } from "./routers/authRouter";
import { importRouter } from "./routers/importRouter";
import { newsRouter } from "./routers/newsRouter";
import { consultRouter } from "./routers/consultRouter";
import { portfolioRouter } from "./routers/portfolio";
import { watchlistRouter } from "./routers/watchlistRouter";
import { actionQueueRouter } from "./routers/actionQueueRouter";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    ...authRouter._def.record,
  }),
  portfolio: portfolioRouter,
  news: newsRouter,
  watchlist: watchlistRouter,
  consult: consultRouter,
  import: importRouter,
  actionQueue: actionQueueRouter,
});

export type AppRouter = typeof appRouter;
