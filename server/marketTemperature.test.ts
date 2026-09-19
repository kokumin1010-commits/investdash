import { describe, expect, it } from "vitest";
import {
  classifyMarketTemperature,
  MARKET_TEMPERATURE_THRESHOLDS,
} from "../shared/marketTemperature";

describe("classifyMarketTemperature", () => {
  it("all available windows inside the fixed limits remain normal", () => {
    const result = classifyMarketTemperature({
      dayPct: 0.14,
      weekPct: 2.1,
      monthPct: -2.4,
    });
    expect(result.level).toBe("NORMAL");
    expect(result.trigger).toBeNull();
    expect(result.availableWindowCount).toBe(3);
  });

  it("uses the most severe triggered window instead of averaging declines away", () => {
    const result = classifyMarketTemperature({
      dayPct: -1,
      weekPct: -8,
      monthPct: -3,
    });
    expect(result.level).toBe("CORRECTION");
    expect(result.trigger).toEqual({
      window: "WEEK",
      changePct: -8,
      thresholdPct: -7,
    });
  });

  it("labels a one-day five-percent fall as a sharp drop", () => {
    const result = classifyMarketTemperature({
      dayPct: -5.2,
      weekPct: null,
      monthPct: null,
    });
    expect(result.level).toBe("SHARP_DROP");
    expect(result.trigger?.window).toBe("DAY");
  });

  it("does not replace unavailable history with zero percent", () => {
    const result = classifyMarketTemperature({
      dayPct: null,
      weekPct: null,
      monthPct: null,
    });
    expect(result.level).toBe("UNAVAILABLE");
    expect(result.availableWindowCount).toBe(0);
  });

  it("keeps thresholds explicit and stable for user auditability", () => {
    expect(MARKET_TEMPERATURE_THRESHOLDS.WATCH).toEqual({
      DAY: -1.5,
      WEEK: -3,
      MONTH: -5,
    });
    expect(MARKET_TEMPERATURE_THRESHOLDS.CORRECTION).toEqual({
      DAY: -3,
      WEEK: -7,
      MONTH: -10,
    });
    expect(MARKET_TEMPERATURE_THRESHOLDS.SHARP_DROP).toEqual({
      DAY: -5,
      WEEK: -10,
      MONTH: -15,
    });
  });
});
