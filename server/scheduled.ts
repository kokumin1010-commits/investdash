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
import { createWeeklyReport } from "./services/reportService";
import { createUrgentReports } from "./services/urgentReport";
import { recordTransitions } from "./services/bandTransitionService";

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
    // 為替レートも syncPrices の中で更新されるため、結果に含めて確認できるようにする
    const results: {
      userId: number;
      updated: number;
      failed: number;
      fxRates?: { usdJpy: number | null; sgdJpy: number | null; hkdJpy: number | null };
      /** 判定が変わった銘柄の数 */
      transitions?: number;
    }[] = [];

    for (const userId of userIds) {
      try {
        const r = await syncPrices(userId);
        /*
         * 株価が変わったら判定変化を記録する。定期更新のたびに記録することで
         * 「いつ買い増し圏に入ったか」が途切れずに残る。
         * 記録の失敗で株価更新を失敗扱いにはしない。
         */
        let transitions = 0;
        try {
          const t = await recordTransitions(userId);
          transitions = t.recorded;
        } catch (error) {
          console.error(`[cron:syncPrices] transition record failed for user ${userId}:`, error);
        }
        results.push({
          userId,
          updated: r.updated,
          failed: r.failed.length,
          fxRates: r.fxRates,
          transitions,
        });
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

/**
 * 週次レポートの生成。
 *
 * 材料は事前に機械的に絞ってから 1 回だけ AI を呼ぶ。112 銘柄を
 * 個別に分析させると 40 分以上かかり、ハンドラの 2 分制限を超える。
 *
 * 材料がない週も生成する。「今週は動く必要がない」と分かること自体に
 * 意味があり、出さないと「レポートが来ないのは壊れているのか」と
 * 区別できなくなる。
 */
export async function weeklyReportHandler(req: Request, res: Response) {
  if (!(await assertCron(req, res))) return;

  try {
    const userIds = await db.listAllUserIds();
    const results: {
      userId: number;
      reportId?: number;
      actionCount?: number;
      topicCount?: number;
      error?: string;
    }[] = [];

    for (const userId of userIds) {
      try {
        const r = await createWeeklyReport(userId, 7);
        results.push({
          userId,
          reportId: r.id,
          actionCount: r.actionCount,
          topicCount: r.topicCount,
        });
      } catch (error) {
        console.error(`[cron:weeklyReport] user ${userId} failed:`, error);
        results.push({ userId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    res.json({ ok: true, users: userIds.length, results });
  } catch (error) {
    console.error("[cron:weeklyReport] fatal:", error);
    res.status(500).json(errorPayload(error, req));
  }
}

/**
 * 臨時レポート（決算・重大ニュース）の生成。
 *
 * 決算日を事前に取得できないため（Yahoo Finance の API に決算予定日が
 * 含まれず、日本株・香港株・SG 株では決算に関する項目が 1 つも返らない）、
 * 起きたことをニュースから検知して出す。
 *
 * ニュース取得（毎朝 7:00）の後に動かす前提。取得前に動かしても
 * 新しいニュースがないため何も出ない。
 */
export async function urgentReportHandler(req: Request, res: Response) {
  if (!(await assertCron(req, res))) return;

  try {
    const userIds = await db.listAllUserIds();
    const results: {
      userId: number;
      created?: number;
      skipped?: number;
      details?: string[];
      error?: string;
    }[] = [];

    for (const userId of userIds) {
      try {
        const r = await createUrgentReports(userId, 26);
        results.push({ userId, created: r.created, skipped: r.skipped, details: r.details });
      } catch (error) {
        console.error(`[cron:urgentReport] user ${userId} failed:`, error);
        results.push({ userId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    res.json({ ok: true, users: userIds.length, results });
  } catch (error) {
    console.error("[cron:urgentReport] fatal:", error);
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
