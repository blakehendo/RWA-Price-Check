import { describe, expect, it } from "vitest";

import { quote as getQuote } from "../lib/adapters/quote";
import { reference as getReference } from "../lib/adapters/reference";
import { calculatePremiumBps, compose } from "../lib/compose";
import { createOrderService } from "../lib/order";
import { priceCheckSummary, priceComparisonDetail } from "../lib/presentation";
import { TICKERS, USDC } from "../lib/tickers";
import type { FillType, MarketStatusResult, QuoteResult, ReferenceResult } from "../lib/types";

const GOLDEN_QUOTES = [
  ["AAPL", 100, "329.3339"],
  ["AAPL", 1_000, "329.4193"],
  ["AAPL", 10_000, "329.4951"],
  ["GOOGL", 100, "344.1145"],
  ["GOOGL", 1_000, "343.7548"],
  ["GOOGL", 10_000, "343.4366"],
  ["NVDA", 100, "229.8669"],
  ["NVDA", 1_000, "229.9725"],
  ["NVDA", 10_000, "230.0242"],
  ["SPY", 100, "777.6058"],
  ["SPY", 1_000, "777.6829"],
  ["SPY", 10_000, "777.8905"],
  ["TSLA", 100, "374.9278"],
  ["TSLA", 1_000, "374.9360"],
  ["TSLA", 10_000, "374.9889"],
] as const;

const REFERENCE_PRICES = {
  AAPL: 320,
  GOOGL: 344,
  NVDA: 230,
  SPY: 778,
  TSLA: 375,
} as const;
const CAPTURED_AT_MS = 1_800_000_120_000;
const REFERENCE_TIMESTAMP = 1_800_000_000;

const regularMarket: MarketStatusResult = {
  source: "finnhub_market_status",
  marketOpen: true,
  marketSession: "regular",
};

const baseQuote: QuoteResult = {
  inAmount: "1000000000",
  outAmount: "1000000000",
  outUsdValue: null,
  feeBps: 0,
  fillType: "amm" as FillType,
  router: "fixture",
  routeLabels: [],
  priceImpactPct: "0",
  raw: {},
};

const oldReference: ReferenceResult = {
  source: "finnhub_quote",
  price: "100",
  timestamp: 1_700_000_000,
  ageSeconds: 1_000_000,
};

describe("15-case quote validation matrix", () => {
  it.each(GOLDEN_QUOTES)(
    "validates the complete %s response at $%i",
    async (ticker, amount, expectedPrice) => {
      const referenceFetch: typeof fetch = async (request) => {
        expect(new URL(String(request)).searchParams.get("symbol")).toBe(ticker);
        return Response.json({
          c: REFERENCE_PRICES[ticker],
          t: REFERENCE_TIMESTAMP,
        });
      };
      const service = createOrderService({
        now: () => CAPTURED_AT_MS,
        quote: (requestedTicker, requestedAmount) => getQuote(requestedTicker, requestedAmount, {
          source: "fixture",
          fixture: requestedAmount,
        }),
        reference: (requestedTicker) => getReference(requestedTicker, {
          apiKey: "fixture-key",
          fetchImpl: referenceFetch,
          nowMs: CAPTURED_AT_MS,
        }),
        marketStatus: async () => regularMarket,
      });

      const result = await service({ ticker, amountUsdc: String(amount) });
      const outputAmount = String(result.body.outAmount);
      const reference = result.body.referencePrice;
      const independentlyCalculatedPrice =
        (Number(result.body.inAmount) / 10 ** USDC.decimals) /
        (Number(outputAmount) / 10 ** TICKERS[ticker].tokenDecimals);
      const independentlyCalculatedPremium = Math.round(
        (Number(reference.quotedPricePerShare) / REFERENCE_PRICES[ticker] - 1) * 10_000,
      ) || 0;

      expect(result.body.inputMint).toBe(USDC.mint);
      expect(result.body.outputMint).toBe(TICKERS[ticker].mint);
      expect(result.body.inAmount).toBe(String(amount * 10 ** USDC.decimals));
      expect(BigInt(outputAmount)).toBeGreaterThan(BigInt(0));
      expect(Number(reference.quotedPricePerShare)).toBeCloseTo(independentlyCalculatedPrice, 7);
      expect(Number(reference.quotedPricePerShare).toFixed(4)).toBe(expectedPrice);
      expect(reference).toMatchObject({
        underlying: ticker,
        source: "finnhub_quote",
        price: String(REFERENCE_PRICES[ticker]),
        timestamp: REFERENCE_TIMESTAMP,
        ageSeconds: 120,
      });
      expect(Number(reference.price)).toBeGreaterThan(0);
      expect(reference.premiumBps).toBe(independentlyCalculatedPremium);
    },
  );

  it("catches an off-by-one error in either USDC or xStock decimals", async () => {
    const quote = await getQuote("TSLA", 1_000, {
      source: "fixture",
      fixture: "1000",
    });
    const result = compose(quote, null, null, "TSLA");

    expect(Number(result.quotedPricePerShare).toFixed(4)).toBe("374.9360");
    expect(result.quotedPricePerShare).not.toBe("37.49360000");
    expect(result.quotedPricePerShare).not.toBe("3749.36000000");
  });

  it("keeps the Jupiter quote and shows no comparison when Finnhub fails", async () => {
    const service = createOrderService({
      quote: (ticker, amount) => getQuote(ticker, amount, {
        source: "fixture",
        fixture: amount,
      }),
      reference: async () => Promise.reject(new Error("Finnhub unavailable")),
      marketStatus: async () => regularMarket,
    });

    const result = await service({ ticker: "NVDA", amountUsdc: "1000" });

    expect(result.body.outputMint).toBe(TICKERS.NVDA.mint);
    expect(BigInt(String(result.body.outAmount))).toBeGreaterThan(BigInt(0));
    expect(result.body.referencePrice).toMatchObject({
      source: null,
      price: null,
      premiumBps: null,
    });
    expect(priceCheckSummary(result.body.referencePrice)).toEqual([
      "Stock price unavailable",
      "No comparison",
    ]);
  });
});

describe("premium behavior", () => {
  it("calculates the premium even when the Finnhub price is old", () => {
    const result = compose(baseQuote, oldReference, null, "TSLA");

    expect(result).toMatchObject({
      ageSeconds: 1_000_000,
      premiumBps: 0,
    });
  });

  it("leaves the premium unavailable only when the reference is unavailable", () => {
    expect(compose(baseQuote, null, null, "TSLA").premiumBps).toBeNull();
  });

  it.each([
    ["100", "100", 0],
    ["101", "100", 100],
    ["99", "100", -100],
    ["102.04", "100", 204],
  ] as const)("calculates %s against %s as %i bps", (quoted, fair, expected) => {
    expect(calculatePremiumBps(quoted, fair)).toBe(expected);
  });
});

describe("price-comparison presentation", () => {
  const reference = {
    ...compose(baseQuote, oldReference, regularMarket, "TSLA"),
    ageSeconds: 30,
  };

  it("labels a negative comparison as a discount with a positive magnitude", () => {
    const discounted = { ...reference, premiumBps: -5 };

    expect(priceComparisonDetail(discounted, "TSLAx")).toEqual({
      label: "TSLAx discount vs. TSLA",
      value: "0.05%",
    });
    expect(priceCheckSummary(discounted)[0]).toBe("0.05% discount vs TSLA");
  });

  it("keeps positive and zero comparisons labeled as premiums", () => {
    expect(priceComparisonDetail({ ...reference, premiumBps: 5 }, "TSLAx")).toEqual({
      label: "TSLAx premium vs. TSLA",
      value: "+0.05%",
    });
    expect(priceComparisonDetail({ ...reference, premiumBps: 0 }, "TSLAx")).toEqual({
      label: "TSLAx premium vs. TSLA",
      value: "0.00%",
    });
  });

  it("keeps the comparison unavailable when Finnhub has no price", () => {
    expect(priceComparisonDetail({ ...reference, premiumBps: null }, "TSLAx")).toEqual({
      label: "TSLAx premium vs. TSLA",
      value: "Unavailable",
    });
  });
});
