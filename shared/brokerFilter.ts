import { BROKERS, type Broker } from "./investing";

/**
 * URL クエリ（?broker=rakuten_ispeed）から口座フィルタを読み取る。
 *
 * ダッシュボードの「証券口座別の資産」カードをタップすると
 * /holdings?broker=xxx へ遷移するため、不正な値が来ても安全に無視する必要がある。
 */
export function parseBrokerFilter(search: string): Broker | null {
  const raw = new URLSearchParams(search).get("broker");
  if (!raw) return null;
  return (BROKERS as readonly string[]).includes(raw) ? (raw as Broker) : null;
}
