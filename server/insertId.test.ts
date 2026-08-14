import { describe, expect, it } from "vitest";
import { extractInsertIdForTest as extractInsertId } from "./db";

/**
 * drizzle の mysql2 ドライバは環境によって INSERT の戻り値の形が変わる。
 * どの形でも ID を取り出せること、取り出せない場合は静かに NaN を流さず
 * 例外になることを保証する。
 */
describe("extractInsertId", () => {
  it("ResultSetHeader を直接受け取った場合", () => {
    expect(extractInsertId({ insertId: 42, affectedRows: 1 }, "holdings")).toBe(42);
  });

  it("[ResultSetHeader, FieldPacket[]] の配列を受け取った場合", () => {
    expect(extractInsertId([{ insertId: 30001, affectedRows: 1 }, []], "importJobs")).toBe(30001);
  });

  it("insertId が bigint の場合も数値に変換する", () => {
    expect(extractInsertId({ insertId: BigInt(60001) }, "signals")).toBe(60001);
  });

  it("insertId が文字列でも数値に変換する", () => {
    expect(extractInsertId({ insertId: "123" }, "watchlist")).toBe(123);
  });

  it("insertId が無い場合は例外を投げる（NaN を後段に流さない）", () => {
    expect(() => extractInsertId({ affectedRows: 1 }, "importJobs")).toThrow(/importJobs/);
    expect(() => extractInsertId({}, "holdings")).toThrow();
    expect(() => extractInsertId(null, "signals")).toThrow();
    expect(() => extractInsertId(undefined, "watchlist")).toThrow();
  });

  it("insertId が 0 の場合も例外を投げる", () => {
    expect(() => extractInsertId({ insertId: 0 }, "importJobs")).toThrow();
  });

  it("空配列を受け取った場合も例外を投げる", () => {
    expect(() => extractInsertId([], "importJobs")).toThrow();
  });

  it("エラーメッセージに受け取った値が含まれる", () => {
    expect(() => extractInsertId({ insertId: null }, "holdings")).toThrow(/null/);
  });
});
