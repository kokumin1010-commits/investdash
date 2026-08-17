/**
 * 相談内容を投資カードに書き戻すときの合わせ方のテスト。
 *
 * 上書きすると手で書いた内容や過去の判断が消える。実際に
 * 三菱商事のカードには AI 下書きの内容が入っていたので、
 * それを残したまま相談の内容を足せることを担保する。
 */
import { describe, expect, it } from "vitest";
import { mergeField } from "./services/consultToCard";

const TODAY = "2026/8/17";

describe("mergeField", () => {
  it("既存が空なら抽出した内容をそのまま入れる", () => {
    expect(mergeField(null, "資源価格の下落", TODAY)).toBe("資源価格の下落");
    expect(mergeField("", "資源価格の下落", TODAY)).toBe("資源価格の下落");
    expect(mergeField("   ", "資源価格の下落", TODAY)).toBe("資源価格の下落");
  });

  it("抽出できなかった項目は既存を保つ（消さない）", () => {
    // 相談で触れていない項目を空にすると、手で書いた内容が失われる
    expect(mergeField("手で書いた撤退条件", null, TODAY)).toBe("手で書いた撤退条件");
    expect(mergeField(null, null, TODAY)).toBeNull();
  });

  it("既存がある場合は日付付きで追記する", () => {
    const existing = "原料炭、銅、LNGなどの資源価格の下落による利益圧縮。";
    const extracted = "IBKRでの日本円借入増加とレバレッジの上昇。";
    const merged = mergeField(existing, extracted, TODAY);
    expect(merged).toContain(existing);
    expect(merged).toContain(extracted);
    expect(merged).toContain("【2026/8/17 の相談より】");
    // 既存が先、追記が後（時系列で読める）
    expect(merged!.indexOf(existing)).toBeLessThan(merged!.indexOf(extracted));
  });

  it("同じ内容を二度足さない", () => {
    const existing = "資源価格の下落による利益圧縮。";
    // 同じ相談を 2 回反映しても増殖しない
    const once = mergeField(existing, "資源価格の下落による利益圧縮。", TODAY);
    expect(once).toBe(existing);
  });

  it("追記を重ねても過去の内容が残る", () => {
    let v = mergeField(null, "1回目の指摘", "2026/8/1");
    v = mergeField(v, "2回目の指摘", "2026/9/1");
    v = mergeField(v, "3回目の指摘", "2026/10/1");
    expect(v).toContain("1回目の指摘");
    expect(v).toContain("2回目の指摘");
    expect(v).toContain("3回目の指摘");
    expect(v).toContain("【2026/9/1 の相談より】");
  });
});
