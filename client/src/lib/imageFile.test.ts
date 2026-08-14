import { describe, expect, it } from "vitest";
import { looksLikeImage } from "./imageFile";

/** File のように振る舞う最小のオブジェクトを作る */
function fakeFile(name: string, type: string): File {
  return { name, type, size: 1024 } as File;
}

/**
 * iOS Safari では写真アプリ経由で選んだファイルの type が空文字になることがある。
 * その場合でも拡張子で画像と判定できることを保証する。
 */
describe("looksLikeImage", () => {
  it("MIME タイプが image/* なら画像と判定する", () => {
    expect(looksLikeImage(fakeFile("a.png", "image/png"))).toBe(true);
    expect(looksLikeImage(fakeFile("b.jpg", "image/jpeg"))).toBe(true);
    expect(looksLikeImage(fakeFile("c.webp", "image/webp"))).toBe(true);
    expect(looksLikeImage(fakeFile("d.heic", "image/heic"))).toBe(true);
  });

  it("MIME タイプが空でも画像の拡張子なら受け付ける（iOS 対策）", () => {
    expect(looksLikeImage(fakeFile("IMG_7555.PNG", ""))).toBe(true);
    expect(looksLikeImage(fakeFile("IMG_7555.HEIC", ""))).toBe(true);
    expect(looksLikeImage(fakeFile("photo.heif", ""))).toBe(true);
    expect(looksLikeImage(fakeFile("shot.jpeg", ""))).toBe(true);
  });

  it("画像でないファイルは弾く", () => {
    expect(looksLikeImage(fakeFile("data.csv", "text/csv"))).toBe(false);
    expect(looksLikeImage(fakeFile("doc.pdf", "application/pdf"))).toBe(false);
    expect(looksLikeImage(fakeFile("noext", ""))).toBe(false);
    expect(looksLikeImage(fakeFile("archive.zip", ""))).toBe(false);
  });

  it("大文字の拡張子も受け付ける", () => {
    expect(looksLikeImage(fakeFile("A.JPG", ""))).toBe(true);
    expect(looksLikeImage(fakeFile("B.WEBP", ""))).toBe(true);
  });
});
