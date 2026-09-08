import { afterEach, describe, expect, it, vi } from "vitest";

import { quote, toAtomicUsdc } from "../lib/adapters/quote";
import { UpstreamError, UpstreamTimeout } from "../lib/errors";

const RFQ_RESPONSE = {
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "1000000000",
  outputMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  outAmount: "400000000",
  outUsdValue: 995,
  feeBps: 5,
  swapType: "rfq",
  router: "jupiterz",
  routePlan: [{ swapInfo: { label: "JupiterZ" } }],
  priceImpactPct: "0",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Jupiter quote adapter", () => {
  it("converts USDC to its atomic six-decimal amount", () => {
    expect(toAtomicUsdc("1000")).toBe("1000000000");
    expect(toAtomicUsdc("10.123456")).toBe("10123456");
    expect(() => toAtomicUsdc("1.0000001")).toThrow(RangeError);
  });

  it("normalizes the recorded fixture and preserves the raw response", async () => {
    vi.stubEnv("QUOTE_SOURCE", "fixture");

    const result = await quote("TSLA", 1000);

    expect(result).toMatchObject({
      inAmount: "1000000000",
      outUsdValue: 998.084984176,
      fillType: "amm",
      router: "metis",
      routeLabels: ["Riptide"],
    });
    expect(result.raw.swapType).toBe("aggregator");
  });

  it("requests a taker-free quote and normalizes RFQ fills", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(RFQ_RESPONSE, { status: 200 }),
    );

    const result = await quote("NVDA", 1000, { fetchImpl });
    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));

    expect(requestedUrl.searchParams.get("inputMint")).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(requestedUrl.searchParams.get("amount")).toBe("1000000000");
    expect(requestedUrl.searchParams.has("taker")).toBe(false);
    expect(result.fillType).toBe("rfq");
    expect(result.outUsdValue).toBe(995);
  });

  it("uses null when Jupiter omits its optional output USD value", async () => {
    const { outUsdValue: _omitted, ...response } = RFQ_RESPONSE;
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(response));

    const result = await quote("NVDA", 1000, { fetchImpl });

    expect(result.outUsdValue).toBeNull();
  });

  it.each([
    ["input mint", { inputMint: "wrong" }],
    ["output mint", { outputMint: "wrong" }],
    ["input amount", { inAmount: "999999999" }],
    ["zero output amount", { outAmount: "0" }],
    ["unsupported swap type", { swapType: "unknown" }],
  ])("rejects a mismatched or malformed %s", async (_case, override) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ ...RFQ_RESPONSE, ...override }),
    );

    await expect(quote("NVDA", 1000, { fetchImpl })).rejects.toBeInstanceOf(TypeError);
  });

  it("throws UpstreamError with the response status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));

    try {
      await quote("TSLA", 1000, { fetchImpl });
      expect.fail("expected quote to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).toMatchObject({
        name: "UpstreamError",
        source: "jupiter",
        status: 503,
      });
    }
  });

  it("throws UpstreamTimeout when the request exceeds its budget", async () => {
    const timeoutError = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const fetchImpl = vi.fn<typeof fetch>(async () => Promise.reject(timeoutError));

    try {
      await quote("TSLA", 1000, { fetchImpl, timeoutMs: 5_000 });
      expect.fail("expected quote to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamTimeout);
      expect(error).toMatchObject({
        name: "UpstreamTimeout",
        source: "jupiter",
        timeoutMs: 5_000,
      });
    }
  });
});
