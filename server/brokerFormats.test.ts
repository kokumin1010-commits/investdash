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
    expect(getBrokerFormat("futu").layoutPrompt).toBeNull();
    expect(getBrokerFormat("generic").layoutPrompt).toBeNull();
  });
});

describe("楽天証券 iSPEED のレイアウト定義", () => {
  const prompt = getBrokerFormat("rakuten_ispeed").layoutPrompt ?? "";

  it("検証済みなので layoutPrompt を持つ", () => {
    expect(prompt).not.toBe("");
    // 日本株と米国株の両方を扱うため、通貨は画面の列見出しから判定する。
    // ここを "JPY" 固定に戻すと米国株がドルとして扱われなくなる。
    expect(getBrokerFormat("rakuten_ispeed").currency).toBeNull();
    expect(getBrokerFormat("rakuten_ispeed").market).toBe("MIXED");
  });

  it("横スクロールで変わる 4 つのビューを説明している", () => {
    // A=取得単価 / B=評価額 / C=指標 / D=米国株。どのビューかで抽出できる項目が変わる
    expect(prompt).toContain("平均取得価額(円)");
    expect(prompt).toContain("時価評価額(円)");
    expect(prompt).toContain("PER");
    expect(prompt).toContain("平均取得価額(ドル)");
  });

  it("日本株画面と米国株画面を列見出しで判別する指示がある", () => {
    // 判定を誤ると円とドルが混ざり評価額が約 150 倍ずれる
    expect(prompt).toContain("ティッカー");
    expect(prompt).toContain("150 倍");
  });

  it("米国株の省略名をティッカーから補完する対応表がある", () => {
    // 「アドバンス…」「バンガー…」のように省略されるため対応表が必要
    expect(prompt).toContain("AAPL→アップル");
    expect(prompt).toContain("VOO→バンガード");
  });

  it("同一ティッカーが 2 行に分かれる場合を説明している", () => {
    // PYPL が 2 建玉で表示された実例。片方を捨てると株数が欠落する
    expect(prompt).toContain("同じティッカーが 2 行");
  });

  it("1 銘柄が 2 行構成であることを明示している", () => {
    // 上下段を別銘柄と誤認すると銘柄数が倍になるため最重要
    expect(prompt).toContain("2 行で構成される");
  });

  it("「（執行中）」を保有数量と誤認しないよう警告している", () => {
    expect(prompt).toContain("（執行中）");
    expect(prompt).toContain("保有数量ではない");
  });

  it("省略された銘柄名の補完表を含む", () => {
    // 実画面で確認した 5 件はすべて例示しておく
    expect(prompt).toContain("3249");
    expect(prompt).toContain("4661");
    expect(prompt).toContain("4689");
    expect(prompt).toContain("4751");
    expect(prompt).toContain("4816");
  });

  it("純資産・預り金が無い画面なので cash を null にすると定めている", () => {
    expect(prompt).toContain("cash は必ず null");
  });

  it("moomoo と逆の配色（赤=プラス）を明示している", () => {
    expect(prompt).toContain("赤字がプラス");
  });

  it("指標ビューを取り込まない方針を明記している", () => {
    // PER 0.00 表示（赤字企業・REIT）を取り込むと判定が歪むため
    expect(prompt).toContain("パターン C は取り込まない");
  });

  it("貸株中バッジと投資口の扱いを説明している", () => {
    expect(prompt).toContain("貸株中");
    expect(prompt).toContain("投資口");
  });

  it("読み取れない行を推測で埋めないよう指示している", () => {
    expect(prompt).toContain("推測して埋めてはならない");
    expect(prompt).toContain("読み取れない銘柄は出力に含めない");
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
    expect(ispeed?.label).toBe("楽天証券 iSPEED");
    expect(ispeed?.verified).toBe(true);

    // 富途は実画面の提供待ちなので未検証のまま
    expect(BROKER_FORMAT_OPTIONS.find(o => o.id === "futu")?.verified).toBe(false);
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
