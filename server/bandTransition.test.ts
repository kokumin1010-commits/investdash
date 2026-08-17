import { describe, expect, it } from "vitest";
import {
  classifyTransition,
  describeTransition,
  hasStateChanged,
} from "../shared/bandTransition";
import type { BandState } from "../shared/bandTransition";

const state = (
  action: BandState["action"],
  label: string | null = null,
  outsideDirection: BandState["outsideDirection"] = null,
): BandState => ({ action, label, outsideDirection });

describe("判定の変化の検知", () => {
  it("段が変わったら記録する", () => {
    expect(hasStateChanged(state("HOLD"), state("ADD_SMALL"))).toBe(true);
    expect(hasStateChanged(state("ADD_SMALL"), state("ADD_MAIN"))).toBe(true);
  });

  it("同じ段のままなら記録しない（株価が動いただけでは残さない）", () => {
    /*
     * 静観の帯の中で $195 → $250 に動いてもとるべき行動は変わらない。
     * 毎回記録すると 112 銘柄 × 1 日 2 回で年 8 万行になり、
     * 本当に変化した時点が埋もれて読めなくなる。
     */
    expect(hasStateChanged(state("HOLD", "静観・保有継続"), state("HOLD", "静観・保有継続"))).toBe(
      false,
    );
  });

  it("初回は記録する（次回以降の比較の基準になる）", () => {
    expect(hasStateChanged(null, state("HOLD"))).toBe(true);
  });

  it("帯の外に出た方向の変化も記録する", () => {
    /*
     * 上に抜けた（高すぎて対象外）と下に抜けた（想定より下落）は
     * どちらも action が null になるため、方向を見ないと区別できない。
     */
    const above = state(null, null, "ABOVE");
    const below = state(null, null, "BELOW");

    expect(hasStateChanged(above, below)).toBe(true);
    expect(hasStateChanged(above, above)).toBe(false);
    expect(hasStateChanged(state("HOLD"), above)).toBe(true);
  });
});

describe("変化の重要度", () => {
  it("主力買い増し・減らすに入ったら必ず高い", () => {
    expect(classifyTransition(state("HOLD"), state("ADD_MAIN"))).toBe("HIGH");
    expect(classifyTransition(state("HOLD"), state("REDUCE"))).toBe("HIGH");
    // 打診買いから主力買い増しへ進んだ場合も高い（投じる金額が増えるため）
    expect(classifyTransition(state("ADD_SMALL"), state("ADD_MAIN"))).toBe("HIGH");
  });

  it("静観から打診買い・要確認に入ったら高い", () => {
    expect(classifyTransition(state("HOLD"), state("ADD_SMALL"))).toBe("HIGH");
    expect(classifyTransition(state("HOLD"), state("VERIFY"))).toBe("HIGH");
  });

  it("主力買い増しから打診買いに戻った場合は高くない", () => {
    // 必要な行動の度合いが下がったので、今すぐ動く必要はない
    expect(classifyTransition(state("ADD_MAIN"), state("ADD_SMALL"))).toBe("MEDIUM");
  });

  it("買い増し圏から静観に戻った場合は中（買い場を逃したことは知りたい）", () => {
    expect(classifyTransition(state("ADD_SMALL"), state("HOLD"))).toBe("MEDIUM");
    expect(classifyTransition(state("ADD_MAIN"), state("HOLD"))).toBe("MEDIUM");
  });

  it("静観のまま帯の外に出た場合は低い", () => {
    expect(classifyTransition(state("HOLD"), state(null, null, "ABOVE"))).toBe("LOW");
  });

  it("初回の記録で買い増し圏にいれば高い", () => {
    expect(classifyTransition(null, state("ADD_MAIN"))).toBe("HIGH");
    expect(classifyTransition(null, state("HOLD"))).toBe("LOW");
  });
});

describe("変化の説明文", () => {
  it("段の説明を使って読める文にする", () => {
    expect(
      describeTransition(state("HOLD", "静観・保有継続"), state("ADD_SMALL", "取得単価付近での打診買い")),
    ).toBe("静観・保有継続 → 取得単価付近での打診買い");
  });

  it("帯の外は方向が分かる言葉にする", () => {
    expect(describeTransition(state("HOLD", "静観"), state(null, null, "BELOW"))).toBe(
      "静観 → 価格帯より下（想定を超える下落）",
    );
    expect(describeTransition(state(null, null, "ABOVE"), state("REDUCE", "一部利益確定"))).toBe(
      "価格帯より上（対象外） → 一部利益確定",
    );
  });

  it("初回は記録の開始と分かる文にする", () => {
    expect(describeTransition(null, state("HOLD", "静観・保有継続"))).toBe(
      "記録を開始: 静観・保有継続",
    );
  });
});
