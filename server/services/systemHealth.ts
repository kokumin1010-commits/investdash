import { readFile } from "node:fs/promises";
import * as db from "../db";

export type RuntimeEvent = {
  at: string;
  kind: string;
  message: string;
};

const MAX_RUNTIME_EVENTS = 12;
const runtimeEvents: RuntimeEvent[] = [];
let memoryMonitorStarted = false;
let memoryLevel: "NORMAL" | "WARNING" | "CRITICAL" = "NORMAL";

export function recordRuntimeEvent(kind: string, error: unknown): void {
  const raw = error instanceof Error ? error.message : String(error);
  runtimeEvents.unshift({
    at: new Date().toISOString(),
    kind: kind.slice(0, 64),
    message: raw.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240),
  });
  runtimeEvents.splice(MAX_RUNTIME_EVENTS);
}

async function readCgroupNumber(path: string): Promise<number | null> {
  try {
    const text = (await readFile(path, "utf8")).trim();
    if (text === "max") return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export async function getSystemHealthSnapshot() {
  const memory = process.memoryUsage();
  const [cgroupCurrent, cgroupMax] = await Promise.all([
    readCgroupNumber("/sys/fs/cgroup/memory.current"),
    readCgroupNumber("/sys/fs/cgroup/memory.max"),
  ]);
  const usagePct =
    cgroupCurrent !== null && cgroupMax !== null && cgroupMax > 0
      ? (cgroupCurrent / cgroupMax) * 100
      : null;

  return {
    uptimeSec: Math.floor(process.uptime()),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cgroupCurrentBytes: cgroupCurrent,
      cgroupMaxBytes: cgroupMax,
      cgroupUsagePct: usagePct === null ? null : Number(usagePct.toFixed(2)),
    },
    recentRuntimeEvents: runtimeEvents.slice(0, 5),
  };
}

export function classifyMemoryLevel(usagePct: number | null, previous = memoryLevel) {
  if (usagePct === null) return previous;
  if (usagePct >= 90) return "CRITICAL" as const;
  if (usagePct >= 80) return "WARNING" as const;
  if (usagePct < 70) return "NORMAL" as const;
  return previous;
}

export async function sampleAndRecordMemory() {
  const snapshot = await getSystemHealthSnapshot();
  const next = classifyMemoryLevel(snapshot.memory.cgroupUsagePct, memoryLevel);
  if (next === memoryLevel) return { changed: false, level: next, snapshot };
  const previous = memoryLevel;
  memoryLevel = next;
  const severity = next === "NORMAL" ? "RECOVERED" : next;
  const title = next === "NORMAL" ? "メモリ使用率が回復" : `メモリ使用率 ${next}`;
  const message = `cgroup ${snapshot.memory.cgroupUsagePct ?? "unknown"}% / RSS ${snapshot.memory.rssBytes}`;
  recordRuntimeEvent("MEMORY_THRESHOLD", `${previous} -> ${next}: ${message}`);
  for (const userId of await db.listAllUserIds()) {
    await db.insertSystemEvent({
      userId,
      source: "APP",
      kind: "MEMORY_THRESHOLD",
      severity,
      eventKey: `memory:${next}:${Date.now()}`,
      title,
      message,
      details: { previous, next, ...snapshot.memory },
    });
  }
  return { changed: true, level: next, snapshot };
}

export function startSystemHealthMonitor() {
  if (memoryMonitorStarted || process.env.NODE_ENV === "test") return;
  memoryMonitorStarted = true;
  const run = () => void sampleAndRecordMemory().catch(error => recordRuntimeEvent("MEMORY_MONITOR", error));
  run();
  const timer = setInterval(run, 60_000);
  timer.unref();
}
