import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { quote } from "../lib/adapters/quote";
import { SUPPORTED_TICKERS } from "../lib/tickers";

const AMOUNTS = [100, 1_000, 10_000] as const;
const CASES = SUPPORTED_TICKERS.flatMap((ticker) =>
  AMOUNTS.map((amount) => ({ ticker, amount })),
);

describe.runIf(process.env.RUN_LIVE_TESTS === "1")("Jupiter live quotes", () => {
  it.each(CASES)("returns a $$$amount quote for $ticker", async ({ ticker, amount }) => {
    const result = await quote(ticker, amount);

    expect(BigInt(result.outAmount)).toBeGreaterThan(BigInt(0));
    expect(result.raw).toHaveProperty("routePlan");
    expect(result.router.length).toBeGreaterThan(0);

    if (process.env.RECORD_FIXTURES === "1") {
      await writeFile(
        join(process.cwd(), "fixtures", `jupiter.${ticker}.${amount}.json`),
        `${JSON.stringify(result.raw)}\n`,
        "utf8",
      );
    }
  }, 15_000);
});
