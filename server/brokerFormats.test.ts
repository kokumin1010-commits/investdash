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

  /*
   * 富途は日本版（moomoo）と香港版で口座が別なので、名前で書き分ける必要がある。
   * 香港版の画面には「富途證券(香港)」「保證金綜合帳戶」が出るため、それを手がかりにする。
   * ここを取り違えると香港の銘柄が日本版の口座に入り、口座別の資産額が狂う。
   */
  it("富途香港を判定する（繁体字の正式名称・保證金綜合帳戶）", () => {
    expect(guessFormatFromBrokerName("富途證券")).toBe("futu_hk");
    expect(guessFormatFromBrokerName("富途證券(香港)")).toBe("futu_hk");
    expect(guessFormatFromBrokerName("富途证券")).toBe("futu_hk");
    expect(guessFormatFromBrokerName("保證金綜合帳戶")).toBe("futu_hk");
    expect(guessFormatFromBrokerName("Futu Securities")).toBe("futu_hk");
    expect(guessFormatFromBrokerName("Futu HK")).toBe("futu_hk");
  });

  it("香港版と判別できない富途表記は日本版側（futu）に寄せる", () => {
    expect(guessFormatFromBrokerName("Futu")).toBe("futu");
    expect(guessFormatFromBrokerName("富途")).toBe("futu");
    expect(guessFormatFromBrokerName("富途牛牛")).toBe("futu");
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

    // 富途香港は実画面（保證金綜合帳戶 3891）で検証済み
    const futuHk = BROKER_FORMAT_OPTIONS.find(o => o.id === "futu_hk");
    expect(futuHk?.label).toBe("富途證券 香港");
    expect(futuHk?.verified).toBe(true);
  });

  it("すべてのフォーマットが含まれる", () => {
    expect(BROKER_FORMAT_OPTIONS.map(o => o.id)).toEqual([
      "moomoo_jp",
      "rakuten_ispeed",
      "ibkr",
      "sc_sg",
      "futu",
      "futu_hk",
      "generic",
    ]);
  });
});

describe("富途證券 香港（保證金綜合帳戶）", () => {
  const format = getBrokerFormat("futu_hk");

  it("実画面で検証済みのレイアウト定義を持つ", () => {
    expect(format.id).toBe("futu_hk");
    expect(format.layoutPrompt).not.toBeNull();
  });

  it("複数市場が混在するため通貨を固定しない", () => {
    // 美股(USD)・港股(HKD)・日股(JPY) が同じ口座に入る
    expect(format.currency).toBeNull();
    expect(format.market).toBe("MIXED");
  });

  /*
   * 「證券」タブと「基金」タブの区別が最重要。
   * 貨幣市場基金を株式として取り込むと、1 株あたりの株価がない商品に
   * 株数と取得単価が割り当てられ、含み損益が意味を失う。
   */
  it("基金タブを株式として取り込まないよう指示している", () => {
    const p = format.layoutPrompt ?? "";
    expect(p).toContain("基金");
    expect(p).toContain("株式として取り込んではならない");
    expect(p).toContain("貨幣市場基金");
  });

  it("港股の 5 桁ゼロ埋めコードの変換を指示している", () => {
    const p = format.layoutPrompt ?? "";
    // 00005 → 0005.HK。ゼロを詰めないと株価が取得できない
    expect(p).toContain("00005");
    expect(p).toContain("0005.HK");
  });

  /*
   * 「最大購買力」は使っていない与信枠。これを借入として読むと
   * 純資産が 1 億円以上過小になる。
   */
  it("最大購買力を借入と誤認しないよう指示している", () => {
    const p = format.layoutPrompt ?? "";
    expect(p).toContain("最大購買力");
    expect(p).toContain("借入ではない");
  });

  it("成本がマイナスになる場合の扱いを指示している", () => {
    const p = format.layoutPrompt ?? "";
    expect(p).toContain("マイナス");
    // 実例（AMD の成本）を挙げて、読み取りミスではないことを伝える
    expect(p).toContain("38.4877");
    expect(p).toContain("マイナス記号を落とさず");
    // 富途自身が損益率を +0.00% と表示するので率を信用しない
    expect(p).toContain("画面の損益率は信用しない");
  });

  it("端株（小数の数量）を丸めないよう指示している", () => {
    const p = format.layoutPrompt ?? "";
    expect(p).toContain("0.5");
    expect(p).toContain("整数に丸めてはならない");
  });

  it("市場セクションごとの通貨対応を持つ", () => {
    const p = format.layoutPrompt ?? "";
    for (const s of ["美股", "港股", "日股"]) {
      expect(p).toContain(s);
    }
    expect(p).toContain("USD");
    expect(p).toContain("HKD");
    expect(p).toContain("JPY");
  });

  it("持倉件数の不足を検知するよう指示している", () => {
    // 実際に 12 銘柄のうち 9 銘柄しか見えず 899 万円不足した事例がある
    const p = format.layoutPrompt ?? "";
    expect(p).toContain("持倉(12)");
    expect(p).toContain("推測で埋めてはならない");
  });

  it("画面から判別できる特徴を持つ", () => {
    expect(format.signatures).toContain("保證金綜合帳戶");
    expect(format.signatures).toContain("名稱代碼");
    expect(format.signatures).toContain("現價/成本");
  });
});

describe("渣打銀行 シンガポール（SC Mobile Trading）", () => {
  const format = getBrokerFormat("sc_sg");

  it("実画面で検証済みのレイアウト定義を持つ", () => {
    expect(format.id).toBe("sc_sg");
    expect(format.layoutPrompt).not.toBeNull();
    expect(BROKER_FORMAT_OPTIONS.find(o => o.id === "sc_sg")?.verified).toBe(true);
  });

  it("日本株と SGX が混在するため通貨を固定しない", () => {
    expect(format.currency).toBeNull();
    expect(format.market).toBe("MIXED");
  });

  it("アプリ名から判定できる", () => {
    expect(guessFormatFromBrokerName("SC Mobile Trading")).toBe("sc_sg");
    expect(guessFormatFromBrokerName("Standard Chartered Bank (Singapore)")).toBe("sc_sg");
    expect(guessFormatFromBrokerName("渣打銀行")).toBe("sc_sg");
  });

  it("平均単価は損益率から逆算するよう指示している", () => {
    // 現在値から求めると誤差が 5 倍になるため、必ず損益率を使わせる
    expect(format.layoutPrompt).toContain("含み損益 ÷ (含み損益率 ÷ 100)");
    expect(format.layoutPrompt).toContain("必ず損益率から求める");
  });

  it("LTV を借入と誤認しないよう指示している", () => {
    // LTV 70% は担保価値の割合であって借入残高ではない
    expect(format.layoutPrompt).toContain("LTV");
    expect(format.layoutPrompt).toContain("借入として扱ってはならない");
  });

  it("市場サフィックスから市場と通貨を判定するよう指示している", () => {
    expect(format.layoutPrompt).toContain(".JP");
    expect(format.layoutPrompt).toContain(".SG");
    expect(format.layoutPrompt).toContain(".SI");
  });

  it("セクション小計を銘柄として取り込まないよう指示している", () => {
    expect(format.layoutPrompt).toContain("セクション小計は保有銘柄ではない");
    expect(format.layoutPrompt).toContain("Total Mkt Value");
  });

  it("画面を見分ける特徴に固有の文字列を含む", () => {
    expect(format.signatures).toContain("SC Mobile Trading");
    expect(format.signatures).toContain("My Holdings Total Value");
    expect(format.signatures).toContain("Ind. Invested Amt");
  });
});
