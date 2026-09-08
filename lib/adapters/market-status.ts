import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MissingConfigurationError,
  UpstreamError,
  UpstreamRateLimited,
  UpstreamTimeout,
} from "../errors";
import type { MarketSession, MarketStatusResult } from "../types";

const DEFAULT_BASE_URL = "https://finnhub.io";
const DEFAULT_TIMEOUT_MS = 5_000;

interface FinnhubMarketStatus extends Record<string, unknown> {
  isOpen?: unknown;
  session?: unknown;
}

export interface MarketStatusOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  fixtureDirectory?: string;
  source?: "live" | "fixture";
  timeoutMs?: number;
}

export async function marketStatus(
  options: MarketStatusOptions = {},
): Promise<MarketStatusResult> {
  const raw =
    (options.source ?? sourceFromEnvironment()) === "fixture"
      ? await readFixture(options.fixtureDirectory)
      : await fetchMarketStatus(options);
  const marketOpen = requiredBoolean(raw.isOpen, "isOpen");

  return {
    source: "finnhub_market_status",
    marketOpen,
    marketSession: normalizeSession(raw.session, marketOpen),
  };
}

function sourceFromEnvironment(): "live" | "fixture" {
  return process.env.MARKET_STATUS_SOURCE === "fixture" ? "fixture" : "live";
}

async function readFixture(
  fixtureDirectory = join(process.cwd(), "fixtures"),
): Promise<FinnhubMarketStatus> {
  const contents = await readFile(
    join(fixtureDirectory, "finnhub-market-status.TSLA.json"),
    "utf8",
  );
  return JSON.parse(contents) as FinnhubMarketStatus;
}

async function fetchMarketStatus(
  options: MarketStatusOptions,
): Promise<FinnhubMarketStatus> {
  const apiKey = options.apiKey ?? process.env.FINNHUB_KEY ?? process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    throw new MissingConfigurationError("FINNHUB_KEY");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(
    "/api/v1/stock/market-status",
    options.baseUrl ?? process.env.FINNHUB_BASE_URL ?? DEFAULT_BASE_URL,
  );
  url.searchParams.set("exchange", "US");

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        accept: "application/json",
        "x-finnhub-token": apiKey,
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new UpstreamRateLimited("finnhub", parseRetryAfter(response.headers));
    }

    if (!response.ok) {
      throw new UpstreamError("finnhub", response.status);
    }

    return (await response.json()) as FinnhubMarketStatus;
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      throw new UpstreamTimeout("finnhub", timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSession(value: unknown, marketOpen: boolean): MarketSession {
  if (value === "pre-market" || value === "regular" || value === "post-market") {
    return value;
  }
  if (value === null && !marketOpen) return "closed";
  return "unknown";
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Finnhub market status is missing boolean field ${field}`);
  }
  return value;
}

function parseRetryAfter(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (value === null) return null;

  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
