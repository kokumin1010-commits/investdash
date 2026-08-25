/**
 * Restore the repository-recorded watchlist without requiring a live quote lookup.
 * Existing rows are updated by (ownerUserId, symbol), so the script is idempotent.
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const SOFTBANK_REASON =
  "【なぜ見るか】保有の情報技術は半導体の設計・製造装置・クラウドに寄っており、AI 分野への投資そのものを事業にしている会社を持っていない。ソフトバンクグループは Arm（半導体設計の基盤・IPO 済み）と OpenAI への出資を通じて AI の上流を押さえており、保有する NVDA・AVGO・ASML などとは別の形で同じ流れに乗る。\n【今の位置】8/19 時点 5,483 円（前日比 -5.95%）。52 週高値 9,074 円に対して39.6% 下、52 週安値 3,365 円からは 63% 上。予想 PER 19.53 倍・PBR 1.77 倍。\n【懸念】この会社の株価は保有資産（Arm・OpenAI・ビジョンファンド）の評価額で動くため、AI 関連株が下がると保有資産の評価と株価が同時に下がり、下落幅が個別株より大きくなる。8/19 の -5.95% も日経平均 -2.82% の 2 倍以上動いており、半導体株が総崩れした日の影響を増幅して受ける性質がある。既に情報技術が構成比 30% を超えレバレッジ 1.18 倍がかかっている状態では、同じ材料で動く銘柄をこれ以上増やすと下落時の耐性が落ちる。\n【配当は期待しない】予想配当 11 円・利回り 0.20%。現金性資産の利回り 3.46% や借入金利 1.73% を大きく下回るため、現金を置き換える先としては不利。値上がりだけを狙う銘柄として扱う。";

const SOFTBANK_CONDITIONS =
  "52 週高値 9,074 円から 4 割下の 5,400 円台は既に安値圏だが、資産評価で動く銘柄は下げ始めると止まりにくいため一度に買わない。\n・4,700 円（52 週安値と現在値の中間）までは打診買いにとどめる\n・Arm の四半期決算でロイヤリティ収入の伸びが鈍っていないことを確認する（この会社の価値の大半が Arm の評価で決まる）\n・NAV（保有資産の純資産価値）に対する株価の割引率を確認する。割引率が縮んでいる局面での買いは避ける\n・OpenAI 関連の出資額が自己資本に対して過大になっていないかを見る\n・9/29 が配当の権利落ち日（1 株 5.5 円）。配当目的ではないため権利取りは狙わない";

const ITEMS = [
  ["CDNS", "CDNS", "Cadence", "US", "USD", null, "EDA の二強の一角。半導体設計の必需品で景気に左右されにくい収益構造。AI チップの設計需要が増えるほどライセンス収入が伸びる。", null],
  ["TSM", "TSM", "TSMC", "US", "USD", null, "先端プロセスをほぼ独占する製造受託。AI 半導体がどこの設計であっても製造を通るため、勝者を選ばずに AI の拡大を取り込める。", null],
  ["ASML", "ASML", "ASML", "US", "USD", null, "EUV 露光装置を独占供給。先端半導体の製造に不可欠で代替が存在しない。台湾集中リスクの分散にもなる欧州銘柄。", null],
  ["VRT", "VRT", "Vertiv", "US", "USD", null, "データセンターの電力・冷却設備。AI の計算需要が増えるほど電力と冷却の必要量が増えるため、半導体とは別の切り口で AI 投資を取り込める。", null],
  ["CRDO", "CRDO", "Credo", "US", "USD", null, "高速接続向け半導体。時価総額が小さく値動きは大きいが、AI サーバー間の通信量増加が直接収益に結びつく。保有の中では最も初期段階の成長株。", null],
  ["QCOM", "QCOM", "QCOM 高通", "US", "USD", null, "PE 18 倍台と AI 関連の中では際立って割安。スマホ依存からの脱却が進めば評価が変わる可能性がある。既に保有する AVGO・MRVL より低い評価水準。", null],
  ["UBER", "UBER", "UBER", "US", "USD", null, "配車と配達で黒字が定着し現金創出力が高い。自動運転タクシーが実現した場合の上振れを、本業の黒字で待てる構造。", null],
  ["NXPI", "NXPI", "NXPI", "US", "USD", null, "車載・産業向け半導体。AI データセンター向けとは需要の波が異なるため、半導体の中でも景気循環の分散になる。", null],
  ["CRM", "CRM", "CRM Salesforce", "US", "USD", null, "企業向けソフトの最大手。AI エージェントの追加課金が浸透すれば既存顧客からの単価上昇が見込める。PE 23 倍台。", null],
  ["9984.T", "9984", "ソフトバンクグループ", "JP", "JPY", 4700, SOFTBANK_REASON, SOFTBANK_CONDITIONS],
  ["285A.T", "285A", "キオクシアホールディングス", "JP", "JPY", 46000, "NAND フラッシュメモリの大手。AI サーバー向けの高容量 SSD 需要が伸びる局面で恩恵を受ける立場にある。保有の半導体はロジック・設計・製造装置に寄っており、記憶装置（メモリ）は持っていないため、同じ AI の流れの中でも別の需給で動く。予想 PER 7.9 倍と設計系より低い水準にある一方、メモリは価格変動が大きく業績の振れも大きい。2026/09/29 に 1 株を 3 株にする分割を予定。", "メモリ価格の下落局面では業績が急速に悪化するため、AI 向け高容量 SSD の出荷が伸び続けているかを決算で確認したうえで打診する。9/29 の株式分割後は 1 株あたりの価格が約 3 分の 1 になるため、目標価格は分割後の水準に読み替える必要がある。"],
];

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [ownerRows] = await connection.execute(
  "SELECT ownerUserId FROM passcodeAuth ORDER BY id LIMIT 1"
);
const ownerUserId = ownerRows[0]?.ownerUserId;
if (!ownerUserId) throw new Error("passcode owner is not initialized");

for (const [symbol, tickerCode, name, market, currency, targetPrice, watchReason, buyConditions] of ITEMS) {
  const [existing] = await connection.execute(
    "SELECT id FROM watchlist WHERE userId = ? AND symbol = ? ORDER BY id LIMIT 1",
    [ownerUserId, symbol]
  );
  if (existing.length > 0) {
    await connection.execute(
      "UPDATE watchlist SET tickerCode=?, name=?, market=?, currency=?, targetPrice=?, watchReason=?, buyConditions=?, priority='MEDIUM' WHERE id=?",
      [tickerCode, name, market, currency, targetPrice, watchReason, buyConditions, existing[0].id]
    );
  } else {
    await connection.execute(
      "INSERT INTO watchlist (userId,symbol,tickerCode,name,market,currency,targetPrice,watchReason,buyConditions,priority) VALUES (?,?,?,?,?,?,?,?,?,'MEDIUM')",
      [ownerUserId, symbol, tickerCode, name, market, currency, targetPrice, watchReason, buyConditions]
    );
  }
}

await connection.end();
console.log(JSON.stringify({ restored: ITEMS.length, ownerUserId }, null, 2));
