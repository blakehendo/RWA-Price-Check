import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { quote as getQuote } from "../lib/adapters/quote";
import {
  createOrderService,
  InvalidOrderRequestError,
  parseOrderRequest,
  QuoteUnavailableError,
  ROUTE_BUDGET_MS,
} from "../lib/order";
import { createOrderHandler } from "../app/api/order/route";
import { SUPPORTED_TICKERS } from "../lib/tickers";
import type { MarketStatusResult, QuoteResult, ReferenceResult } from "../lib/types";

const quote: QuoteResult = {
  inAmount: "1000000000",
  outAmount: "250000000",
  outUsdValue: 995,
  feeBps: 0,
  fillType: "amm",
  router: "jupiterz",
  routeLabels: ["HumidiFi"],
  priceImpactPct: "0",
  raw: {
    inAmount: "1000000000",
    outAmount: "250000000",
    router: "jupiterz",
    requestId: "fixture-request",
  },
};

const reference: ReferenceResult = {
  source: "finnhub_quote",
  price: "400",
  timestamp: 1_700_000_000,
  ageSeconds: 20,
};

const marketStatus: MarketStatusResult = {
  source: "finnhub_market_status",
  marketOpen: true,
  marketSession: "regular",
};

describe("order request validation", () => {
  it("normalizes a supported ticker and accepts the inclusive amount bounds", () => {
    expect(parse("ticker=tsla&amountUsdc=10")).toEqual({ ticker: "TSLA", amountUsdc: "10" });
    expect(parse("ticker=AAPL&amountUsdc=100000")).toEqual({
      ticker: "AAPL",
      amountUsdc: "100000",
    });
  });

  it.each(["ticker=NOPE&amountUsdc=100", "amountUsdc=100"])(
    "returns a typed validation error for an unsupported ticker in %s",
    (query) => {
      expect(() => parse(query)).toThrowError(
        expect.objectContaining<Partial<InvalidOrderRequestError>>({ code: "UNKNOWN_TICKER" }),
      );
    },
  );

  it.each([
    "ticker=TSLA",
    "ticker=TSLA&amountUsdc=9.99",
    "ticker=TSLA&amountUsdc=100000.01",
    "ticker=TSLA&amountUsdc=10.0000001",
    "ticker=TSLA&amountUsdc=wat",
  ])("returns a typed validation error for an invalid amount in %s", (query) => {
    expect(() => parse(query)).toThrowError(
      expect.objectContaining<Partial<InvalidOrderRequestError>>({ code: "INVALID_AMOUNT" }),
    );
  });
});

describe("order service", () => {
  it("fans out all three adapters and preserves every raw Jupiter field", async () => {
    const quoteAdapter = vi.fn(async () => quote);
    const referenceAdapter = vi.fn(async () => reference);
    const marketStatusAdapter = vi.fn(async () => marketStatus);
    const service = createOrderService({
      now: sequenceClock(1_700_000_020_000),
      quote: quoteAdapter,
      reference: referenceAdapter,
      marketStatus: marketStatusAdapter,
    });

    const result = await service({ ticker: "TSLA", amountUsdc: "1000" });

    expect(result.body).toMatchObject({
      inAmount: quote.raw.inAmount,
      outAmount: quote.raw.outAmount,
      router: quote.raw.router,
      requestId: quote.raw.requestId,
      referencePrice: {
        underlying: "TSLA",
        jupiterPricePerShareUsd: "398.00",
        premiumBps: 0,
        marketOpen: true,
        marketSession: "regular",
      },
    });
    expect(result.meta).toMatchObject({
      cached: { quote: false, reference: false, marketStatus: false },
    });
    expect(quoteAdapter).toHaveBeenCalledTimes(1);
    expect(referenceAdapter).toHaveBeenCalledTimes(1);
    expect(marketStatusAdapter).toHaveBeenCalledTimes(1);
  });

  it("serves quote, reference, and market status from their caches inside each TTL", async () => {
    let nowMs = 1_700_000_020_000;
    const quoteAdapter = vi.fn(async () => quote);
    const referenceAdapter = vi.fn(async () => reference);
    const marketStatusAdapter = vi.fn(async () => marketStatus);
    const service = createOrderService({
      now: () => nowMs,
      quote: quoteAdapter,
      reference: referenceAdapter,
      marketStatus: marketStatusAdapter,
    });

    await service({ ticker: "TSLA", amountUsdc: "1000" });
    nowMs += 4_000;
    const second = await service({ ticker: "TSLA", amountUsdc: "1000" });

    expect(second.meta.cached).toEqual({ quote: true, reference: true, marketStatus: true });
    expect(quoteAdapter).toHaveBeenCalledTimes(1);
    expect(referenceAdapter).toHaveBeenCalledTimes(1);
    expect(marketStatusAdapter).toHaveBeenCalledTimes(1);
  });

  it("expires each upstream on its own TTL", async () => {
    let nowMs = 1_700_000_020_000;
    const quoteAdapter = vi.fn(async () => quote);
    const referenceAdapter = vi.fn(async () => reference);
    const marketStatusAdapter = vi.fn(async () => marketStatus);
    const service = createOrderService({
      now: () => nowMs,
      quote: quoteAdapter,
      reference: referenceAdapter,
      marketStatus: marketStatusAdapter,
    });

    await service({ ticker: "TSLA", amountUsdc: "1000" });
    nowMs += 6_000;
    expect((await service({ ticker: "TSLA", amountUsdc: "1000" })).meta.cached).toEqual({
      quote: true,
      reference: false,
      marketStatus: true,
    });
    nowMs += 5_000;
    expect((await service({ ticker: "TSLA", amountUsdc: "1000" })).meta.cached).toEqual({
      quote: false,
      reference: false,
      marketStatus: true,
    });
  });

  it("returns no comparison when the reference adapter fails", async () => {
    const service = createOrderService({
      quote: async () => quote,
      reference: async () => Promise.reject(new Error("FINNHUB_KEY missing")),
      marketStatus: async () => marketStatus,
    });

    const result = await service({ ticker: "TSLA", amountUsdc: "1000" });

    expect(result.body.referencePrice).toMatchObject({
      source: null,
      price: null,
      premiumBps: null,
    });
  });

  it("keeps the premium when the Finnhub market-status call fails", async () => {
    const service = createOrderService({
      now: () => Date.parse("2026-09-03T17:00:00Z"),
      quote: async () => quote,
      reference: async () => reference,
      marketStatus: async () => Promise.reject(new Error("market status unavailable")),
    });

    const result = await service({ ticker: "TSLA", amountUsdc: "1000" });

    expect(result.body.referencePrice).toMatchObject({
      marketOpen: null,
      marketSession: "unknown",
      premiumBps: 0,
    });
  });

  it("throws a quote-specific error when the quote adapter fails", async () => {
    const service = createOrderService({
      quote: async () => Promise.reject(new Error("Jupiter unavailable")),
      reference: async () => reference,
      marketStatus: async () => marketStatus,
    });

    await expect(service({ ticker: "TSLA", amountUsdc: "1000" })).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
  });

  it("accepts a Jupiter quote that completes after 800 ms but before the hard deadline", async () => {
    vi.useFakeTimers();

    try {
      const service = createOrderService({
        quote: async () => delayed(quote, 900),
        reference: async () => reference,
        marketStatus: async () => marketStatus,
      });
      const resultPromise = service({ ticker: "TSLA", amountUsdc: "1000" });

      await vi.advanceTimersByTimeAsync(900);

      await expect(resultPromise).resolves.toMatchObject({
        body: { referencePrice: { premiumBps: 0 } },
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("preserves the Jupiter quote when Finnhub exceeds the hard deadline", async () => {
    vi.useFakeTimers();

    try {
      const service = createOrderService({
        quote: async () => quote,
        reference: async () => delayed(reference, ROUTE_BUDGET_MS * 2),
        marketStatus: async () => marketStatus,
      });
      const resultPromise = service({ ticker: "TSLA", amountUsdc: "1000" });

      await vi.advanceTimersByTimeAsync(ROUTE_BUDGET_MS);

      await expect(resultPromise).resolves.toMatchObject({
        body: {
          outAmount: quote.raw.outAmount,
          referencePrice: { source: null, price: null, premiumBps: null },
        },
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("returns a typed 502 when Jupiter exceeds the hard deadline", async () => {
    vi.useFakeTimers();

    try {
      const service = createOrderService({
        quote: async () => delayed(quote, ROUTE_BUDGET_MS * 2),
        reference: async () => reference,
        marketStatus: async () => marketStatus,
      });
      const handler = createOrderHandler(service);
      const responsePromise = handler(
        new Request("https://example.test/api/order?ticker=TSLA&amountUsdc=1000"),
      );

      await vi.advanceTimersByTimeAsync(ROUTE_BUDGET_MS);

      const response = await responsePromise;
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error: "QUOTE_UNAVAILABLE",
        message: "A Jupiter quote is unavailable within the request budget",
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it.each(SUPPORTED_TICKERS)(
    "adds only referencePrice to the raw %s Jupiter fixture",
    async (ticker) => {
      const raw = JSON.parse(
        await readFile(join(process.cwd(), "fixtures", `jupiter.${ticker}.1000.json`), "utf8"),
      ) as Record<string, unknown>;
      const service = createOrderService({
        quote: (value, amount) =>
          getQuote(value, amount, { source: "fixture", fixture: "1000" }),
        reference: async () => Promise.reject(new Error("reference intentionally absent")),
        marketStatus: async () => marketStatus,
      });
      const result = await service({ ticker, amountUsdc: "1000" });
      const { referencePrice: attached, ...jupiter } = result.body;

      expect(jupiter).toEqual(raw);
      expect(Object.keys(attached)).toHaveLength(11);
    },
  );
});

function parse(query: string) {
  return parseOrderRequest(new URLSearchParams(query));
}

function sequenceClock(start: number) {
  let current = start;
  return () => current++;
}

function delayed<T>(value: T, delayMs: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
}
