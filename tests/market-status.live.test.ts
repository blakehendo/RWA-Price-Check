import { describe, expect, it } from "vitest";

import { marketStatus } from "../lib/adapters/market-status";

describe.runIf(process.env.RUN_LIVE_TESTS === "1")("Finnhub live U.S. market status", () => {
  it("returns an open flag and normalized session", async () => {
    const result = await marketStatus();

    expect(typeof result.marketOpen).toBe("boolean");
    expect(["pre-market", "regular", "post-market", "closed", "unknown"]).toContain(
      result.marketSession,
    );
  }, 10_000);
});
