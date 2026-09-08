import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MissingConfigurationError,
  UpstreamError,
  UpstreamRateLimited,
  UpstreamTimeout,
} from "../errors";
import { getTicker, type Ticker } from "../tickers";
import type { ReferenceResult } from "../types";

const DEFAULT_BASE_URL = "https://finnhub.io";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_FUTURE_SKEW_SECONDS = 60;

interface FinnhubQuote extends Record<string, unknown> {
  c?: unknown;
  t?: unknown;
}

export interface ReferenceOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  fixture?: "fresh" | "stale";
  fixtureDirectory?: string;
  nowMs?: number;
  source?: "live" | "fixture";
  timeoutMs?: number;
}

export async function reference(
  ticker: string,
  options: ReferenceOptions = {},
): Promise<ReferenceResult> {
  const config = getTicker(ticker);
  const source = options.source ?? sourceFromEnvironment();
  const raw =
    source === "fixture"
      ? await readFixture(
          config.underlying as Ticker,
          options.fixture ?? fixtureFromEnvironment(),
          options.fixtureDirectory,
        )
      : await fetchReference(config.underlying, options);

  return normalizeReference(raw, options.nowMs ?? Date.now());
}

function sourceFromEnvironment(): "live" | "fixture" {
  return process.env.REFERENCE_SOURCE === "fixture" ? "fixture" : "live";
}

function fixtureFromEnvironment(): "fresh" | "stale" {
  return process.env.REFERENCE_FIXTURE === "stale" ? "stale" : "fresh";
}

async function readFixture(
  ticker: Ticker,
  fixture: "fresh" | "stale",
  fixtureDirectory = join(process.cwd(), "fixtures"),
): Promise<FinnhubQuote> {
  const suffix = fixture === "stale" ? ".stale" : "";
  const contents = await readFile(join(fixtureDirectory, `finnhub.${ticker}${suffix}.json`), "utf8");

  return JSON.parse(contents) as FinnhubQuote;
}

async function fetchReference(
  ticker: string,
  options: ReferenceOptions,
): Promise<FinnhubQuote> {
  const apiKey = options.apiKey ?? process.env.FINNHUB_KEY ?? process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    throw new MissingConfigurationError("FINNHUB_KEY");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL("/api/v1/quote", options.baseUrl ?? process.env.FINNHUB_BASE_URL ?? DEFAULT_BASE_URL);
  url.searchParams.set("symbol", ticker);

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

    return (await response.json()) as FinnhubQuote;
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

function normalizeReference(raw: FinnhubQuote, nowMs: number): ReferenceResult {
  const price = requiredPositiveNumber(raw.c, "c");
  const timestamp = requiredPositiveInteger(raw.t, "t");
  const nowSeconds = Math.floor(nowMs / 1_000);
  if (timestamp > nowSeconds + MAX_FUTURE_SKEW_SECONDS) {
    throw new TypeError("Finnhub quote timestamp is unexpectedly in the future");
  }
  return {
    source: "finnhub_quote",
    price: String(price),
    timestamp,
    ageSeconds: Math.max(0, nowSeconds - timestamp),
  };
}

function parseRetryAfter(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (value === null) return null;

  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Finnhub response is missing number field ${field}`);
  }

  return value;
}

function requiredPositiveNumber(value: unknown, field: string): number {
  const number = requiredNumber(value, field);
  if (number <= 0) {
    throw new TypeError(`Finnhub response has invalid positive number field ${field}`);
  }
  return number;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const number = requiredPositiveNumber(value, field);
  if (!Number.isInteger(number)) {
    throw new TypeError(`Finnhub response has invalid integer field ${field}`);
  }
  return number;
}
