import { describe, expect, it } from "vitest";
import {
  MAX_FAILED_ATTEMPTS,
  PASSCODE_MAX_LENGTH,
  PASSCODE_MIN_LENGTH,
  hashPasscode,
  isValidPasscodeFormat,
  issueToken,
  safeCompare,
  verifyToken,
} from "./services/passcode";

describe("パスコードの形式検証", () => {
  it("4 桁の数字を受け入れる", () => {
    expect(isValidPasscodeFormat("1010")).toBe(true);
  });

  it("6 桁の数字を受け入れる", () => {
    expect(isValidPasscodeFormat("123456")).toBe(true);
  });

  it("3 桁は短すぎるため拒否する", () => {
    expect(isValidPasscodeFormat("123")).toBe(false);
  });

  it("7 桁は長すぎるため拒否する", () => {
    expect(isValidPasscodeFormat("1234567")).toBe(false);
  });

  it("数字以外を含む場合は拒否する", () => {
    expect(isValidPasscodeFormat("12a4")).toBe(false);
    expect(isValidPasscodeFormat("12 4")).toBe(false);
    expect(isValidPasscodeFormat("")).toBe(false);
  });

  it("許容桁数の定数が想定どおり", () => {
    expect(PASSCODE_MIN_LENGTH).toBe(4);
    expect(PASSCODE_MAX_LENGTH).toBe(6);
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
  });
});

describe("パスコードのハッシュ化", () => {
  it("同じパスコードとソルトからは同じハッシュが得られる", () => {
    const salt = "abc123";
    expect(hashPasscode("1010", salt)).toBe(hashPasscode("1010", salt));
  });

  it("ソルトが違えば異なるハッシュになる", () => {
    expect(hashPasscode("1010", "salt-a")).not.toBe(hashPasscode("1010", "salt-b"));
  });

  it("パスコードが違えば異なるハッシュになる", () => {
    const salt = "abc123";
    expect(hashPasscode("1010", salt)).not.toBe(hashPasscode("1011", salt));
  });

  it("ハッシュに元のパスコードが含まれない", () => {
    const hash = hashPasscode("1010", "abc123");
    expect(hash).not.toContain("1010");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("安全な文字列比較", () => {
  it("同一文字列で true を返す", () => {
    expect(safeCompare("abcdef", "abcdef")).toBe(true);
  });

  it("異なる文字列で false を返す", () => {
    expect(safeCompare("abcdef", "abcdeg")).toBe(false);
  });

  it("長さが違う場合も例外を投げずに false を返す", () => {
    expect(safeCompare("abc", "abcdef")).toBe(false);
  });
});

describe("セッショントークン", () => {
  it("発行したトークンから所有者 ID を復元できる", async () => {
    const token = await issueToken(42);
    expect(await verifyToken(token)).toBe(42);
  });

  it("改ざんされたトークンを拒否する", async () => {
    const token = await issueToken(42);
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(await verifyToken(tampered)).toBeNull();
  });

  it("トークン形式でない文字列を拒否する", async () => {
    expect(await verifyToken("not-a-token")).toBeNull();
    expect(await verifyToken("")).toBeNull();
  });
});
