import { describe, expect, it, vi } from "vitest";

import { marketStatus } from "../lib/adapters/market-status";
import { UpstreamRateLimited } from "../lib/errors";

describe("Finnhub U.S. market-status adapter", () => {
  it("maps the recorded post-market fixture", async () => {
    await expect(marketStatus({ source: "fixture" })).resolves.toEqual({
      source: "finnhub_market_status",
      marketOpen: false,
      marketSession: "post-market",
    });
  });

  it("calls Finnhub's U.S. market-status endpoint with the API key header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ exchange: "US", isOpen: true, session: "regular" }),
    );

    const result = await marketStatus({ apiKey: "test-key", fetchImpl });

    expect(result).toEqual({
      source: "finnhub_market_status",
      marketOpen: true,
      marketSession: "regular",
    });
    const [request, init] = fetchImpl.mock.calls[0];
    expect(String(request)).toBe("https://finnhub.io/api/v1/stock/market-status?exchange=US");
    expect(new Headers(init?.headers).get("x-finnhub-token")).toBe("test-key");
  });

  it("maps a closed market with no named session to closed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ exchange: "US", isOpen: false, session: null }),
    );

    await expect(marketStatus({ apiKey: "test-key", fetchImpl })).resolves.toMatchObject({
      marketOpen: false,
      marketSession: "closed",
    });
  });

  it("classifies 429 without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 429, headers: { "retry-after": "12" } }),
    );

    await expect(marketStatus({ apiKey: "test-key", fetchImpl })).rejects.toMatchObject<
      Partial<UpstreamRateLimited>
    >({
      name: "UpstreamRateLimited",
      source: "finnhub",
      status: 429,
      retryAfterSeconds: 12,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
