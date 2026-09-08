import { describe, expect, it } from "vitest";

import { reference } from "../lib/adapters/reference";

describe.runIf(process.env.RUN_LIVE_TESTS === "1")("Finnhub live reference", () => {
  it("returns a timestamped TSLA reference", async () => {
    const result = await reference("TSLA");

    expect(Number(result.price)).toBeGreaterThan(0);
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.ageSeconds).toBeGreaterThanOrEqual(0);
  }, 10_000);
});
