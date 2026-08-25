export type BackfillCandidate = {
  symbol: string;
  value: number;
};

export type BackfillRun = {
  symbol: string | null;
  status: "SUCCESS" | "FAILED";
  createdAt: Date;
};

/**
 * 运行日志必须按新到旧传入。每个 symbol 只看最新一次结果；最新成功时，
 * 更早的失败不能继续把该标的放进冷却。
 */
export function selectBackfillQueue<T extends BackfillCandidate>(
  candidates: T[],
  runs: BackfillRun[],
  opts: { retryFailed: boolean; failureCooldownMs: number; now?: number }
): { eligible: T[]; deferred: T[] } {
  const latest = new Map<string, BackfillRun>();
  for (const run of runs) {
    if (!run.symbol || latest.has(run.symbol)) continue;
    latest.set(run.symbol, run);
  }

  const sorted = [...candidates].sort(
    (a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol)
  );
  if (opts.retryFailed) return { eligible: sorted, deferred: [] };

  const now = opts.now ?? Date.now();
  const eligible: T[] = [];
  const deferred: T[] = [];
  for (const candidate of sorted) {
    const run = latest.get(candidate.symbol);
    if (
      run?.status === "FAILED" &&
      now - run.createdAt.getTime() < opts.failureCooldownMs
    ) {
      deferred.push(candidate);
    } else {
      eligible.push(candidate);
    }
  }
  return { eligible, deferred };
}
