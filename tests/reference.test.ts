import { afterEach, describe, expect, it, vi } from "vitest";

import { reference } from "../lib/adapters/reference";
import { UpstreamRateLimited } from "../lib/errors";

const CAPTURED_AT_MS = Date.parse("2026-09-03T22:01:35Z");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Finnhub reference adapter", () => {
  it("maps the fresh fixture and computes age from the source timestamp", async () => {
    const result = await reference("TSLA", {
      source: "fixture",
      fixture: "fresh",
      nowMs: CAPTURED_AT_MS,
    });

    expect(result).toEqual({
      source: "finnhub_quote",
      price: "376.365",
      timestamp: 1_788_465_600,
      ageSeconds: 7_295,
    });
  });

  it("loads the deliberately stale fixture", async () => {
    const result = await reference("TSLA", {
      source: "fixture",
      fixture: "stale",
      nowMs: CAPTURED_AT_MS,
    });

    expect(result.timestamp).toBe(1_787_428_800);
    expect(result.ageSeconds).toBe(1_044_095);
  });

  it("selects the stale fixture through the environment", async () => {
    vi.stubEnv("REFERENCE_SOURCE", "fixture");
    vi.stubEnv("REFERENCE_FIXTURE", "stale");

    const result = await reference("TSLA", { nowMs: CAPTURED_AT_MS });

    expect(result.ageSeconds).toBeGreaterThan(1_000_000);
  });

  it("requests the quote with the Finnhub API key header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ c: 100, b: 99, a: 101, t: 1_700_000_000 }),
    );

    const result = await reference("TSLA", {
      apiKey: "test-key",
      fetchImpl,
      nowMs: 1_700_000_010_000,
    });

    expect(result).toMatchObject({ price: "100", ageSeconds: 10 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("x-finnhub-token")).toBe(
      "test-key",
    );
  });

  it.each([
    ["zero price", { c: 0, t: 1_700_000_000 }],
    ["zero timestamp", { c: 100, t: 0 }],
    ["fractional timestamp", { c: 100, t: 1_700_000_000.5 }],
  ])("rejects a Finnhub response with a %s", async (_case, response) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(response));

    await expect(reference("TSLA", {
      apiKey: "test-key",
      fetchImpl,
      nowMs: 1_700_000_010_000,
    })).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects a Finnhub timestamp more than one minute in the future", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ c: 100, t: 1_700_000_071 }),
    );

    await expect(reference("TSLA", {
      apiKey: "test-key",
      fetchImpl,
      nowMs: 1_700_000_010_000,
    })).rejects.toThrow("unexpectedly in the future");
  });

  it("classifies 429 without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 429, headers: { "retry-after": "12" } }),
    );

    try {
      await reference("TSLA", { apiKey: "test-key", fetchImpl });
      expect.fail("expected reference to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamRateLimited);
      expect(error).toMatchObject({
        source: "finnhub",
        status: 429,
        retryAfterSeconds: 12,
      });
    }

    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
