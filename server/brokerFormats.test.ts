import { describe, expect, it } from "vitest";
import {
  BROKER_FORMAT_OPTIONS,
  getBrokerFormat,
  guessFormatFromBrokerName,
} from "./services/brokerFormats";

describe("getBrokerFormat", () => {
  it("moomoo 日本版のレイアウト定義を返す", () => {
    const format = getBrokerFormat("moomoo_jp");
    expect(format.id).toBe("moomoo_jp");
    expect(format.currency).toBe("JPY");
    expect(format.layoutPrompt).not.toBeNull();
  });

  it("レイアウト定義に列の対応が含まれる", () => {
    const prompt = getBrokerFormat("moomoo_jp").layoutPrompt ?? "";
    // 4 列すべての見出しが説明に含まれていること
    expect(prompt).toContain("銘柄名/コード");
    expect(prompt).toContain("評価額/数量");
    expect(prompt).toContain("評価損益");
    expect(prompt).toContain("現在値/取得単価");
    // 取得単価の逆算式が含まれていること
    expect(prompt).toContain("評価額 − 評価損益");
  });

  it("未知の ID は generic にフォールバックする", () => {
    expect(getBrokerFormat(null).id).toBe("generic");
    expect(getBrokerFormat(undefined).id).toBe("generic");
  });

  it("未検証のフォーマットは layoutPrompt が null", () => {
    expect(getBrokerFormat("rakuten_ispeed").layoutPrompt).toBeNull();
    expect(getBrokerFormat("futu").layoutPrompt).toBeNull();
  });
});

describe("guessFormatFromBrokerName", () => {
  it("moomoo を判定する", () => {
    expect(guessFormatFromBrokerName("moomoo")).toBe("moomoo_jp");
    expect(guessFormatFromBrokerName("moomoo証券")).toBe("moomoo_jp");
    expect(guessFormatFromBrokerName("MooMoo Japan")).toBe("moomoo_jp");
  });

  it("楽天証券を判定する", () => {
    expect(guessFormatFromBrokerName("楽天証券")).toBe("rakuten_ispeed");
    expect(guessFormatFromBrokerName("iSPEED")).toBe("rakuten_ispeed");
  });

  it("富途を判定する", () => {
    expect(guessFormatFromBrokerName("富途證券")).toBe("futu");
    expect(guessFormatFromBrokerName("Futu")).toBe("futu");
  });

  it("判定できない場合は generic", () => {
    expect(guessFormatFromBrokerName(null)).toBe("generic");
    expect(guessFormatFromBrokerName("")).toBe("generic");
    expect(guessFormatFromBrokerName("SBI証券")).toBe("generic");
  });
});

describe("BROKER_FORMAT_OPTIONS", () => {
  it("画面表示用の一覧を返し、検証済みかどうかが分かる", () => {
    const moomoo = BROKER_FORMAT_OPTIONS.find(o => o.id === "moomoo_jp");
    expect(moomoo?.label).toBe("moomoo 日本版");
    expect(moomoo?.verified).toBe(true);

    const ispeed = BROKER_FORMAT_OPTIONS.find(o => o.id === "rakuten_ispeed");
    expect(ispeed?.verified).toBe(false);
  });

  it("すべてのフォーマットが含まれる", () => {
    expect(BROKER_FORMAT_OPTIONS.map(o => o.id)).toEqual([
      "moomoo_jp",
      "rakuten_ispeed",
      "futu",
      "generic",
    ]);
  });
});
