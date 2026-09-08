import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { UpstreamError, UpstreamTimeout } from "../errors";
import { getTicker, type Ticker, USDC } from "../tickers";
import type { QuoteResult } from "../types";

const DEFAULT_BASE_URL = "https://lite-api.jup.ag";
const DEFAULT_TIMEOUT_MS = 5_000;

interface JupiterSwapInfo {
  label?: unknown;
}

interface JupiterRouteStep {
  swapInfo?: JupiterSwapInfo;
}

interface JupiterOrder extends Record<string, unknown> {
  inputMint?: unknown;
  inAmount?: unknown;
  outputMint?: unknown;
  outAmount?: unknown;
  outUsdValue?: unknown;
  feeBps?: unknown;
  swapType?: unknown;
  router?: unknown;
  routePlan?: unknown;
  priceImpactPct?: unknown;
}

export interface QuoteOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  fixture?: string;
  fixtureDirectory?: string;
  source?: "live" | "fixture";
  timeoutMs?: number;
}

export async function quote(
  ticker: string,
  amountUsdc: number | string,
  options: QuoteOptions = {},
): Promise<QuoteResult> {
  const config = getTicker(ticker);
  const source = options.source ?? sourceFromEnvironment();
  const inAmount = toAtomicUsdc(amountUsdc);
  const raw =
    source === "fixture"
      ? await readFixture(
          config.underlying as Ticker,
          options.fixture,
          options.fixtureDirectory,
        )
      : await fetchQuote(config.mint, inAmount, options);

  return normalizeQuote(raw, {
    inputMint: USDC.mint,
    outputMint: config.mint,
    inAmount,
  });
}

export function toAtomicUsdc(amountUsdc: number | string): string {
  const value = String(amountUsdc).trim();

  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new RangeError("USDC amount must be a non-negative decimal with at most 6 places");
  }

  const [whole, fraction = ""] = value.split(".");
  const scale = BigInt(10) ** BigInt(USDC.decimals);

  return (BigInt(whole) * scale + BigInt(fraction.padEnd(USDC.decimals, "0"))).toString();
}

function sourceFromEnvironment(): "live" | "fixture" {
  return process.env.QUOTE_SOURCE === "fixture" ? "fixture" : "live";
}

async function readFixture(
  ticker: Ticker,
  fixture: string | undefined,
  fixtureDirectory = join(process.cwd(), "fixtures"),
): Promise<JupiterOrder> {
  const suffix = fixture ? `.${fixture}` : "";
  const contents = await readFile(
    join(fixtureDirectory, `jupiter.${ticker}${suffix}.json`),
    "utf8",
  );
  return JSON.parse(contents) as JupiterOrder;
}

async function fetchQuote(
  outputMint: string,
  amount: string,
  options: QuoteOptions,
): Promise<JupiterOrder> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL("/ultra/v1/order", options.baseUrl ?? process.env.JUPITER_BASE_URL ?? DEFAULT_BASE_URL);

  url.search = new URLSearchParams({
    inputMint: USDC.mint,
    outputMint,
    amount,
  }).toString();

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new UpstreamError("jupiter", response.status);
    }

    return (await response.json()) as JupiterOrder;
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      throw new UpstreamTimeout("jupiter", timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeQuote(
  raw: JupiterOrder,
  expected: { inputMint: string; outputMint: string; inAmount: string },
): QuoteResult {
  const routePlan = Array.isArray(raw.routePlan) ? (raw.routePlan as JupiterRouteStep[]) : [];
  const inputMint = requiredString(raw.inputMint, "inputMint");
  const outputMint = requiredString(raw.outputMint, "outputMint");
  const inAmount = requiredAtomicAmount(raw.inAmount, "inAmount");
  const outAmount = requiredAtomicAmount(raw.outAmount, "outAmount");

  if (inputMint !== expected.inputMint) {
    throw new TypeError("Jupiter response inputMint does not match the request");
  }
  if (outputMint !== expected.outputMint) {
    throw new TypeError("Jupiter response outputMint does not match the request");
  }
  if (inAmount !== expected.inAmount) {
    throw new TypeError("Jupiter response inAmount does not match the request");
  }
  if (raw.swapType !== "rfq" && raw.swapType !== "aggregator") {
    throw new TypeError("Jupiter response has an unsupported swapType");
  }

  return {
    inAmount,
    outAmount,
    outUsdValue: optionalNonNegativeNumber(raw.outUsdValue, "outUsdValue"),
    feeBps: requiredNonNegativeNumber(raw.feeBps, "feeBps"),
    fillType: raw.swapType === "rfq" ? "rfq" : "amm",
    router: requiredNonEmptyString(raw.router, "router"),
    routeLabels: routePlan.flatMap(({ swapInfo }) =>
      typeof swapInfo?.label === "string" ? [swapInfo.label] : [],
    ),
    priceImpactPct: requiredDecimalString(raw.priceImpactPct, "priceImpactPct"),
    raw,
  };
}

function optionalNonNegativeNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return requiredNonNegativeNumber(value, field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Jupiter response is missing string field ${field}`);
  }

  return value;
}

function requiredNonEmptyString(value: unknown, field: string): string {
  const string = requiredString(value, field);
  if (string.length === 0) {
    throw new TypeError(`Jupiter response is missing non-empty string field ${field}`);
  }
  return string;
}

function requiredAtomicAmount(value: unknown, field: string): string {
  const amount = requiredString(value, field);
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0) {
    throw new TypeError(`Jupiter response has invalid atomic amount ${field}`);
  }
  return amount;
}

function requiredDecimalString(value: unknown, field: string): string {
  const decimal = requiredString(value, field);
  if (!/^-?\d+(?:\.\d+)?$/.test(decimal)) {
    throw new TypeError(`Jupiter response has invalid decimal field ${field}`);
  }
  return decimal;
}

function requiredNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`Jupiter response is missing number field ${field}`);
  }

  return value;
}
