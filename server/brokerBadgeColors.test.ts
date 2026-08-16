import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BROKERS,
  BROKER_HEX,
  BROKER_STYLES,
  brokerStyle,
  SIGNAL_STYLES,
} from "../shared/investing";

/**
 * 口座バッジがすべてグレーに見えていた不具合の再発防止。
 *
 * 原因は色の指定漏れではなく CSS の生成漏れだった。
 * Tailwind 4 は Vite の root（client/）配下しか走査しないため、
 * shared/investing.ts に書いたクラス名は CSS に出力されず無効化されていた。
 * `client/src/index.css` の `@source` で走査範囲を広げて解決したので、
 * この設定が失われたら気付けるようにしておく。
 */
const cssPath = path.resolve(__dirname, "../client/src/index.css");
const css = fs.readFileSync(cssPath, "utf8");

describe("Tailwind の走査範囲", () => {
  it("shared を @source に含めている（口座バッジ・シグナル色の CSS 生成に必要）", () => {
    expect(css).toMatch(/@source\s+"\.\.\/\.\.\/shared"/);
  });

  it("server/services も @source に含めている", () => {
    expect(css).toMatch(/@source\s+"\.\.\/\.\.\/server\/services"/);
  });
});

describe("口座ごとの色", () => {
  it("すべての口座に色クラスが定義されている", () => {
    for (const broker of BROKERS) {
      expect(BROKER_STYLES[broker], `${broker} のスタイル`).toBeTruthy();
    }
  });

  it("実際に使う 4 口座は互いに異なる色になっている", () => {
    const used = ["moomoo_jp", "rakuten_ispeed", "ibkr", "sc_sg"] as const;
    const styles = used.map((b) => brokerStyle(b));
    expect(new Set(styles).size).toBe(used.length);
  });

  it("バッジの色と円グラフの色（HEX）で同じ色相を使っている", () => {
    // クラス名の色名と HEX の対応が崩れると、表の縦線とバッジの色が食い違う
    const hue: Record<string, string> = {
      moomoo_jp: "orange",
      rakuten_ispeed: "red",
      ibkr: "violet",
      sc_sg: "teal",
    };
    const hex: Record<string, string> = {
      orange: "#f97316",
      red: "#dc2626",
      violet: "#7c3aed",
      teal: "#0d9488",
    };
    for (const [broker, name] of Object.entries(hue)) {
      expect(BROKER_STYLES[broker as (typeof BROKERS)[number]]).toContain(name);
      expect(BROKER_HEX[broker as (typeof BROKERS)[number]]).toBe(hex[name]);
    }
  });

  it("色クラスは背景・文字・枠線の 3 つを揃えている（文字が読めなくなるのを防ぐ）", () => {
    for (const broker of ["moomoo_jp", "rakuten_ispeed", "ibkr", "sc_sg"] as const) {
      const style = BROKER_STYLES[broker];
      expect(style, `${broker} に背景色`).toMatch(/\bbg-/);
      expect(style, `${broker} に文字色`).toMatch(/\btext-/);
      expect(style, `${broker} に枠線色`).toMatch(/\bborder-/);
      expect(style, `${broker} に暗色テーマの文字色`).toMatch(/dark:text-/);
    }
  });
});

describe("シグナルの色", () => {
  it("ADD / HOLD / WATCH / REDUCE / EXIT すべてに色がある", () => {
    for (const signal of ["ADD", "HOLD", "WATCH", "REDUCE", "EXIT"] as const) {
      expect(SIGNAL_STYLES[signal], `${signal} のスタイル`).toBeTruthy();
    }
  });

  it("ADD と EXIT は反対の意味なので異なる色になっている", () => {
    expect(SIGNAL_STYLES.ADD).not.toBe(SIGNAL_STYLES.EXIT);
  });
});
