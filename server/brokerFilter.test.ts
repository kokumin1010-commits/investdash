import { describe, expect, it } from "vitest";
import { parseBrokerFilter } from "@shared/brokerFilter";

describe("parseBrokerFilter", () => {
  it("有効な口座キーを読み取る", () => {
    expect(parseBrokerFilter("?broker=rakuten_ispeed")).toBe("rakuten_ispeed");
    expect(parseBrokerFilter("?broker=moomoo_jp")).toBe("moomoo_jp");
    expect(parseBrokerFilter("?broker=futu")).toBe("futu");
  });

  it("先頭の ? がなくても読み取れる", () => {
    expect(parseBrokerFilter("broker=moomoo_jp")).toBe("moomoo_jp");
  });

  it("他のクエリが混在していても読み取れる", () => {
    // devToken 付きで開くケースを想定
    expect(parseBrokerFilter("?devToken=abc&broker=moomoo_jp")).toBe("moomoo_jp");
  });

  it("未知の値は無視する", () => {
    expect(parseBrokerFilter("?broker=sbi")).toBeNull();
    expect(parseBrokerFilter("?broker=ALL")).toBeNull();
  });

  it("指定がない場合は null を返す", () => {
    expect(parseBrokerFilter("")).toBeNull();
    expect(parseBrokerFilter("?other=1")).toBeNull();
  });

  it("空の broker は null を返す", () => {
    expect(parseBrokerFilter("?broker=")).toBeNull();
  });
});
