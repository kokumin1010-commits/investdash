import { describe, expect, it } from "vitest";
import { classifyMemoryLevel } from "./services/systemHealth";

describe("memory threshold hysteresis", () => {
  it("raises warning and critical at 80/90 percent", () => {
    expect(classifyMemoryLevel(80, "NORMAL")).toBe("WARNING");
    expect(classifyMemoryLevel(90, "WARNING")).toBe("CRITICAL");
  });

  it("does not recover until below 70 percent", () => {
    expect(classifyMemoryLevel(75, "CRITICAL")).toBe("CRITICAL");
    expect(classifyMemoryLevel(69.9, "CRITICAL")).toBe("NORMAL");
  });
});
