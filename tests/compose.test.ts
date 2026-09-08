import { describe, expect, it } from "vitest";

import { quote as getQuote } from "../lib/adapters/quote";
import { reference as getReference } from "../lib/adapters/reference";
import { compose } from "../lib/compose";
import { referencePriceSchema } from "../lib/schema";
import type { MarketStatusResult, QuoteResult, ReferenceResult } from "../lib/types";

const regularMarket: MarketStatusResult = {
  source: "finnhub_market_status",
  marketOpen: true,
  marketSession: "regular",
};

const reference: ReferenceResult = {
  source: "finnhub_quote",
  price: "100",
  timestamp: 1_700_000_000,
  ageSeconds: 30,
};

const nvdaQuote: QuoteResult = {
  inAmount: "1000000000",
  outAmount: "1000000000",
  outUsdValue: 995,
  feeBps: 5,
  fillType: "rfq",
  router: "jupiterz",
  routeLabels: ["JupiterZ"],
  priceImpactPct: "0",
  raw: { fixture: "NVDA" },
};

describe("referencePrice composer", () => {
  it("combines the quote, Finnhub price, and Finnhub market status", () => {
    const result = compose(nvdaQuote, reference, regularMarket, "NVDA");

    expect(result).toEqual({
      underlying: "NVDA",
      source: "finnhub_quote",
      price: "100",
      timestamp: 1_700_000_000,
      ageSeconds: 30,
      marketOpen: true,
      marketSession: "regular",
      jupiterPricePerShareUsd: "99.50",
      quotedPricePerShare: "100.00",
      premiumBps: 0,
      fillType: "rfq",
    });
    expect(referencePriceSchema.parse(result)).toEqual(result);
    expect(referencePriceSchema.safeParse({ ...result, token: "extra-field" }).success).toBe(false);
  });

  it("keeps the premium for an old Finnhub price and exposes its age", async () => {
    const [quote, oldReference] = await Promise.all([
      getQuote("TSLA", 1_000, { source: "fixture" }),
      getReference("TSLA", {
        source: "fixture",
        fixture: "stale",
        nowMs: Date.parse("2026-09-03T22:01:35Z"),
      }),
    ]);

    const result = compose(
      quote,
      oldReference,
      { ...regularMarket, marketOpen: false, marketSession: "post-market" },
      "TSLA",
    );

    expect(result).toMatchObject({
      ageSeconds: 1_044_095,
      marketOpen: false,
      marketSession: "post-market",
      premiumBps: 54,
    });
  });

  it("returns no premium when Finnhub returns no price", () => {
    const result = compose(nvdaQuote, null, regularMarket, "NVDA");

    expect(result).toMatchObject({
      source: null,
      price: null,
      premiumBps: null,
      quotedPricePerShare: "100.00",
      marketOpen: true,
      marketSession: "regular",
    });
  });

  it("keeps the price comparison when Finnhub market status is unavailable", () => {
    const result = compose(nvdaQuote, reference, null, "NVDA");

    expect(result).toMatchObject({
      marketOpen: null,
      marketSession: "unknown",
      premiumBps: 0,
    });
  });

  it("returns a null Jupiter token price when the quote omits outUsdValue", () => {
    const result = compose(
      { ...nvdaQuote, outUsdValue: null },
      reference,
      regularMarket,
      "NVDA",
    );

    expect(result.jupiterPricePerShareUsd).toBeNull();
  });

  it("reports a large premium without converting it into a verdict", () => {
    const result = compose(
      nvdaQuote,
      { ...reference, price: "98" },
      regularMarket,
      "NVDA",
    );

    expect(result.premiumBps).toBe(204);
    expect(result).not.toHaveProperty("verdict");
  });
});
