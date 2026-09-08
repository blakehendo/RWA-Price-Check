import {
  marketStatus as fetchMarketStatus,
  type MarketStatusOptions,
} from "./adapters/market-status";
import { quote as fetchQuote, type QuoteOptions } from "./adapters/quote";
import { reference as fetchReference, type ReferenceOptions } from "./adapters/reference";
import { compose } from "./compose";
import { getTicker, SUPPORTED_TICKERS, type Ticker } from "./tickers";
import type { MarketStatusResult, QuoteResult, ReferenceResult } from "./types";

export const ROUTE_BUDGET_MS = 2_500;
const COMPOSITION_RESERVE_MS = 50;
const QUOTE_TTL_MS = 10_000;
const REFERENCE_TTL_MS = 5_000;
const MARKET_STATUS_TTL_MS = 60_000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface CachedResult<T> {
  cached: boolean;
  value: T;
}

export interface OrderRequest {
  amountUsdc: string;
  ticker: Ticker;
}

export interface OrderServiceMeta {
  latencyMs: number;
  cached: {
    quote: boolean;
    reference: boolean;
    marketStatus: boolean;
  };
  serverTime: string;
}

export interface OrderResponse extends Record<string, unknown> {
  referencePrice: ReturnType<typeof compose>;
}

export interface OrderServiceResult {
  body: OrderResponse;
  meta: OrderServiceMeta;
}

export interface OrderDependencies {
  now?: () => number;
  quote?: (ticker: string, amountUsdc: string, options: QuoteOptions) => Promise<QuoteResult>;
  reference?: (ticker: string, options: ReferenceOptions) => Promise<ReferenceResult>;
  marketStatus?: (options: MarketStatusOptions) => Promise<MarketStatusResult>;
}

export class InvalidOrderRequestError extends Error {
  readonly code: "INVALID_AMOUNT" | "UNKNOWN_TICKER";

  constructor(code: InvalidOrderRequestError["code"], message: string) {
    super(message);
    this.name = "InvalidOrderRequestError";
    this.code = code;
  }
}

export class QuoteUnavailableError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("A Jupiter quote is unavailable within the request budget");
    this.name = "QuoteUnavailableError";
    this.cause = cause;
  }
}

export function parseOrderRequest(searchParams: URLSearchParams): OrderRequest {
  const rawTicker = searchParams.get("ticker")?.trim() ?? "";
  const ticker = rawTicker.toUpperCase();

  try {
    getTicker(ticker);
  } catch {
    throw new InvalidOrderRequestError(
      "UNKNOWN_TICKER",
      `ticker must be one of: ${SUPPORTED_TICKERS.join(", ")}`,
    );
  }

  const amountUsdc = searchParams.get("amountUsdc")?.trim() ?? "";
  if (!/^\d+(?:\.\d{1,6})?$/.test(amountUsdc)) {
    throw new InvalidOrderRequestError(
      "INVALID_AMOUNT",
      "amountUsdc must be a decimal with at most 6 fractional digits",
    );
  }

  const numericAmount = Number(amountUsdc);
  if (!Number.isFinite(numericAmount) || numericAmount < 10 || numericAmount > 100_000) {
    throw new InvalidOrderRequestError(
      "INVALID_AMOUNT",
      "amountUsdc must be between 10 and 100000",
    );
  }

  return { ticker: ticker as Ticker, amountUsdc };
}

export function createOrderService(dependencies: OrderDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const quoteAdapter = dependencies.quote ?? fetchQuote;
  const referenceAdapter = dependencies.reference ?? fetchReference;
  const marketStatusAdapter = dependencies.marketStatus ?? fetchMarketStatus;
  const quoteCache = new Map<string, CacheEntry<QuoteResult>>();
  const referenceCache = new Map<string, CacheEntry<ReferenceResult>>();
  const marketStatusCache = new Map<string, CacheEntry<MarketStatusResult>>();

  return async ({ ticker, amountUsdc }: OrderRequest): Promise<OrderServiceResult> => {
    const startedAt = now();
    // Leave room for settled-result handling, composition, and JSON serialization.
    const deadline = startedAt + ROUTE_BUDGET_MS - COMPOSITION_RESERVE_MS;
    const quoteKey = `${ticker}:${amountUsdc}`;

    const [quoteResult, referenceResult, marketStatusResult] = await Promise.allSettled([
      withinDeadline(
        readThrough(quoteCache, quoteKey, QUOTE_TTL_MS, now, () =>
          quoteAdapter(ticker, amountUsdc, { timeoutMs: remaining(deadline, now) }),
        ),
        deadline,
        now,
      ),
      withinDeadline(
        readThrough(referenceCache, ticker, REFERENCE_TTL_MS, now, () =>
          referenceAdapter(ticker, { timeoutMs: remaining(deadline, now) }),
        ),
        deadline,
        now,
      ),
      withinDeadline(
        readThrough(marketStatusCache, "US", MARKET_STATUS_TTL_MS, now, () =>
          marketStatusAdapter({ timeoutMs: remaining(deadline, now) }),
        ),
        deadline,
        now,
      ),
    ]);

    if (quoteResult.status === "rejected") {
      throw new QuoteUnavailableError(quoteResult.reason);
    }

    const reference = referenceResult.status === "fulfilled" ? referenceResult.value.value : null;
    const currentMarketStatus =
      marketStatusResult.status === "fulfilled" ? marketStatusResult.value.value : null;
    const referencePrice = compose(
      quoteResult.value.value,
      reference,
      currentMarketStatus,
      ticker,
    );
    const completedAt = now();

    return {
      body: {
        ...quoteResult.value.value.raw,
        referencePrice,
      },
      meta: {
        latencyMs: Math.max(0, completedAt - startedAt),
        cached: {
          quote: quoteResult.value.cached,
          reference:
            referenceResult.status === "fulfilled" && referenceResult.value.cached,
          marketStatus:
            marketStatusResult.status === "fulfilled" && marketStatusResult.value.cached,
        },
        serverTime: new Date(completedAt).toISOString(),
      },
    };
  };
}

async function readThrough<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  now: () => number,
  load: () => Promise<T>,
): Promise<CachedResult<T>> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) {
    return { cached: true, value: cached.value };
  }

  cache.delete(key);
  const value = await load();
  cache.set(key, { expiresAt: now() + ttlMs, value });
  return { cached: false, value };
}

async function withinDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  now: () => number,
): Promise<T> {
  const timeoutMs = remaining(deadline, now);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Order request budget exceeded")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, deadline - now());
}

export const getOrder = createOrderService();
