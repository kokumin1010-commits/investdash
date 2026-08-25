// AI が提案した未保有 9 銘柄をウォッチリストに登録する。
// 目標価格は指定せず null にする（後で AI に価格帯を提案させるため）。
const BASE = process.env.SEED_BASE ?? "http://127.0.0.1:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";

const ITEMS = [
  { code: "CDNS", watchReason: "EDA の二強の一角。半導体設計の必需品で景気に左右されにくい収益構造。AI チップの設計需要が増えるほどライセンス収入が伸びる。" },
  { code: "TSM", watchReason: "先端プロセスをほぼ独占する製造受託。AI 半導体がどこの設計であっても製造を通るため、勝者を選ばずに AI の拡大を取り込める。" },
  { code: "ASML", watchReason: "EUV 露光装置を独占供給。先端半導体の製造に不可欠で代替が存在しない。台湾集中リスクの分散にもなる欧州銘柄。" },
  { code: "VRT", watchReason: "データセンターの電力・冷却設備。AI の計算需要が増えるほど電力と冷却の必要量が増えるため、半導体とは別の切り口で AI 投資を取り込める。" },
  { code: "CRDO", watchReason: "高速接続向け半導体。時価総額が小さく値動きは大きいが、AI サーバー間の通信量増加が直接収益に結びつく。保有の中では最も初期段階の成長株。" },
  { code: "QCOM", watchReason: "PE 18 倍台と AI 関連の中では際立って割安。スマホ依存からの脱却が進めば評価が変わる可能性がある。既に保有する AVGO・MRVL より低い評価水準。" },
  { code: "UBER", watchReason: "配車と配達で黒字が定着し現金創出力が高い。自動運転タクシーが実現した場合の上振れを、本業の黒字で待てる構造。" },
  { code: "NXPI", watchReason: "車載・産業向け半導体。AI データセンター向けとは需要の波が異なるため、半導体の中でも景気循環の分散になる。" },
  { code: "CRM", watchReason: "企業向けソフトの最大手。AI エージェントの追加課金が浸透すれば既存顧客からの単価上昇が見込める。PE 23 倍台。" },
];

async function call(path, json, token) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ json }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

const unlock = await call("auth.unlock", { passcode: PASSCODE });
const token = unlock?.result?.data?.json?.token;
if (!token) {
  throw new Error(unlock?.error?.json?.message ?? "パスコード認証に失敗しました");
}

for (const item of ITEMS) {
  const out = await call("watchlist.add", {
    code: item.code,
    watchReason: item.watchReason,
    priority: "MEDIUM",
    targetPrice: null,
  }, token);
  const ok = out?.result?.data?.json;
  const err = out?.error?.json?.message ?? out?.error?.message ?? out?.raw;
  console.log(item.code, ok ? `OK id=${ok.id} ${ok.symbol}` : `FAIL ${err}`);
}
