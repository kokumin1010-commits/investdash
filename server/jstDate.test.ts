import { describe, expect, it } from "vitest";
import { jstDayBounds, jstDayKey } from "../shared/jstDate";

describe("JST daily snapshot date helpers", () => {
  it("uses the Japanese calendar day around the UTC boundary", () => {
    expect(jstDayKey(new Date("2026-08-25T14:59:59.999Z"))).toBe("2026-08-25");
    expect(jstDayKey(new Date("2026-08-25T15:00:00.000Z"))).toBe("2026-08-26");
  });

  it("returns the UTC half-open interval for a Japanese day", () => {
    const bounds = jstDayBounds(new Date("2026-08-26T03:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-08-25T15:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-08-26T15:00:00.000Z");
  });

  it("handles year rollover without using the server local timezone", () => {
    const bounds = jstDayBounds(new Date("2026-12-31T16:00:00.000Z"));
    expect(jstDayKey(new Date("2026-12-31T16:00:00.000Z"))).toBe("2027-01-01");
    expect(bounds.start.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2027-01-01T15:00:00.000Z");
  });
});
