/**
 * Heartbeat（HTTP cron）から呼ばれる定期実行ハンドラ。
 *
 * - `/api/scheduled/syncPrices` : 全ユーザーの保有・ウォッチ銘柄の株価を更新
 * - `/api/scheduled/syncNews`   : 全ユーザーのニュースを取得し AI 分析、シグナルを再生成
 *
 * いずれも冪等。失敗したユーザーはスキップし、処理結果を JSON で返す。
 */
import type { Request, Response } from "express";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { regenerateSignal, syncNewsForUser, syncPrices } from "./services/portfolio";

/** cron 呼び出しであることを検証する。cron 以外は 403。 */
async function assertCron(req: Request, res: Response): Promise<boolean> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) {
      res.status(403).json({ error: "cron-only" });
      return false;
    }
    return true;
  } catch (error) {
    res.status(403).json({ error: "unauthorized", detail: String(error) });
    return false;
  }
}

function errorPayload(error: unknown, req: Request) {
  return {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context: { url: req.originalUrl },
    timestamp: new Date().toISOString(),
  };
}

/** 株価の定期更新 */
export async function syncPricesHandler(req: Request, res: Response) {
  if (!(await assertCron(req, res))) return;

  try {
    const userIds = await db.listAllUserIds();
    const results: { userId: number; updated: number; failed: number }[] = [];

    for (const userId of userIds) {
      try {
        const r = await syncPrices(userId);
        results.push({ userId, updated: r.updated, failed: r.failed.length });
      } catch (error) {
        console.error(`[cron:syncPrices] user ${userId} failed:`, error);
        results.push({ userId, updated: 0, failed: -1 });
      }
    }

    res.json({ ok: true, users: userIds.length, results });
  } catch (error) {
    console.error("[cron:syncPrices] fatal:", error);
    res.status(500).json(errorPayload(error, req));
  }
}

/** ニュースの定期取得・AI 分析・シグナル再生成 */
export async function syncNewsHandler(req: Request, res: Response) {
  if (!(await assertCron(req, res))) return;

  try {
    const userIds = await db.listAllUserIds();
    const results: {
      userId: number;
      fetched: number;
      analyzed: number;
      signals: number;
      skipped?: boolean;
    }[] = [];

    for (const userId of userIds) {
      try {
        const settings = await db.getSettings(userId);
        if (!settings.autoNewsEnabled) {
          results.push({ userId, fetched: 0, analyzed: 0, signals: 0, skipped: true });
          continue;
        }

        const news = await syncNewsForUser(userId);

        // 影響度の高いニュースが入った銘柄のシグナルを再生成する
        let signals = 0;
        const holdings = await db.listHoldings(userId);
        for (const holding of holdings) {
          try {
            await regenerateSignal(userId, holding);
            signals += 1;
          } catch (error) {
            console.error(
              `[cron:syncNews] signal failed for user ${userId} / ${holding.symbol}:`,
              error
            );
          }
        }

        // 古いニュースを整理する
        await db.pruneOldNews(userId, 90);

        results.push({ userId, fetched: news.fetched, analyzed: news.analyzed, signals });
      } catch (error) {
        console.error(`[cron:syncNews] user ${userId} failed:`, error);
        results.push({ userId, fetched: 0, analyzed: 0, signals: 0 });
      }
    }

    res.json({ ok: true, users: userIds.length, results });
  } catch (error) {
    console.error("[cron:syncNews] fatal:", error);
    res.status(500).json(errorPayload(error, req));
  }
}
