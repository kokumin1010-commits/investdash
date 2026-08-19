/**
 * 「なぜこの銘柄を買い増すのか」を実データから組み立てる。
 *
 * 【なぜ AI に書かせないか】
 * 保有一覧の 29 銘柄すべてに AI で理由を書かせると 1 銘柄 15 秒で 7 分以上かかり、
 * 一覧を開くたびに走らせることはできない。また AI に自由に書かせると
 * 「成長性が期待できるため」のような検証できない文になりやすい。
 *
 * ここで出すのは「なぜ今この額を入れてよいのか」の根拠であり、
 * その材料（判定・構成比・配当利回りと金利の比較・値位置）はすべて
 * 手元の数字で確定している。数字から言えることは数字から作る。
 *
 * AI の見解（判定の本文・今から買うかの判断）は別枠で既に画面に出ており、
 * ここはそれを置き換えるものではなく「金額の根拠」を補うもの。
 */

import { MAX_POSITION_SHARE_PCT } from "./addSizing";

export type AddReasonInput = {
  /** シグナル判定。ADD 以外では理由を出さない */
  action: string | null;
  /** 「今この株を持っていなかったら買うか」の判定 */
  wouldBuyNow: string | null;
  /** 現在の構成比（%） */
  currentSharePct: number | null;
  /** 買い増し後の構成比（%） */
  afterSharePct: number | null;
  /** 配当利回り（%）。未取得なら null */
  dividendYieldPct: number | null;
  /** 借入の実効金利（%） */
  borrowRatePct: number | null;
  /** 現金性資産の利回り（%） */
  cashYieldPct: number | null;
  /** 52 週レンジ内の位置（0〜100%）。0 が安値・100 が高値 */
  rangePositionPct: number | null;
  /** 取得単価に対する現在値の乖離（%）。プラスなら含み益 */
  vsAvgCostPct: number | null;
};

export type AddReason = {
  /** 箇条書きにする根拠。空なら理由を出さない */
  points: string[];
  /** 留意点。買う方向を否定はしないが、知っておくべきこと */
  cautions: string[];
};

/**
 * 52 週レンジ内で「安い」と見なす上限（%）。
 * 中央（50%）より下であれば安値寄りと言えるが、判断材料として
 * 言及する価値があるのは 3 分の 1 より下の水準に限る。
 */
const CHEAP_RANGE_PCT = 35;
/** 逆に「高値圏」と見なす下限（%） */
const EXPENSIVE_RANGE_PCT = 85;

export function buildAddReason(input: AddReasonInput): AddReason {
  const points: string[] = [];
  const cautions: string[] = [];

  // ADD 以外では金額を出していないので理由も作らない
  if (input.action !== "ADD") return { points, cautions };

  /*
   * 1. 「今から買うか」の判定を最初に置く。
   *
   * これが買い増しの是非を最も直接に表す。取得単価がいくらであっても
   * 「今この値段で買うか」が YES でなければ買い増す理由にならない。
   */
  if (input.wouldBuyNow === "YES") {
    points.push("今この株を持っていなかったとしても、現在値で買うと判断されている");
  } else if (input.wouldBuyNow === "NO") {
    cautions.push(
      "「今から新規には買わない」と判定されている。買い増しは慎重に検討してください"
    );
  } else if (input.wouldBuyNow === "UNCLEAR") {
    cautions.push("「今から買うか」は判断できないとされている");
  }

  /*
   * 2. 構成比の余地。
   *
   * 上限（5%）までどれだけ余裕があるかは金額を決めた根拠そのもの。
   * 「買っても上限内に収まる」ことが言えて初めてこの額が正当化される。
   */
  if (input.currentSharePct !== null && input.afterSharePct !== null) {
    points.push(
      `構成比 ${input.currentSharePct.toFixed(1)}% で、買い増しても ${input.afterSharePct.toFixed(
        1
      )}%（上限 ${MAX_POSITION_SHARE_PCT}%）に収まる`
    );
  }

  /*
   * 3. 配当利回りと金利・現金利回りの比較。
   *
   * 現金の利回り（3.46%）が借入金利（1.73%）を上回っている状況では、
   * 現金を株に替えるかどうかは利回りの比較で判断できる。
   * 配当利回りが現金利回りを下回る銘柄は、値上がりだけを狙う買いになる。
   */
  const dy = input.dividendYieldPct;
  if (dy !== null && dy > 0) {
    if (input.cashYieldPct !== null && dy >= input.cashYieldPct) {
      points.push(
        `配当利回り ${dy.toFixed(2)}% が現金の利回り ${input.cashYieldPct.toFixed(
          2
        )}% を上回るため、現金を株に替えて収支が改善する`
      );
    } else if (input.borrowRatePct !== null && dy >= input.borrowRatePct) {
      points.push(
        `配当利回り ${dy.toFixed(2)}% が借入金利 ${input.borrowRatePct.toFixed(2)}% を上回る`
      );
      if (input.cashYieldPct !== null) {
        cautions.push(
          `ただし現金の利回り ${input.cashYieldPct.toFixed(
            2
          )}% は下回るため、現金を崩す分だけ利息収入は減る`
        );
      }
    } else if (input.borrowRatePct !== null) {
      cautions.push(
        `配当利回り ${dy.toFixed(2)}% は借入金利 ${input.borrowRatePct.toFixed(
          2
        )}% を下回るため、値上がりを狙う買いになる`
      );
    }
  }

  /*
   * 4. 値位置。
   *
   * 52 週レンジ内の位置は「安く買えているか」の唯一の客観指標。
   * 取得単価との比較ではなく市場価格の中での位置を使う
   * （取得単価は過去の自分の判断であって、今の価値とは関係がない）。
   */
  const rp = input.rangePositionPct;
  if (rp !== null) {
    if (rp <= CHEAP_RANGE_PCT) {
      points.push(`52 週レンジの下から ${rp.toFixed(0)}% の水準で、1 年の中では安い側にある`);
    } else if (rp >= EXPENSIVE_RANGE_PCT) {
      cautions.push(
        `52 週レンジの上から ${(100 - rp).toFixed(0)}% の高値圏にあり、押し目を待つ選択もある`
      );
    }
  }

  return { points, cautions };
}
