export type MarketSession =
  | "pre-market"
  | "regular"
  | "post-market"
  | "closed"
  | "unknown";

export type FillType = "rfq" | "amm";

export interface QuoteResult {
  inAmount: string;
  outAmount: string;
  outUsdValue: number | null;
  feeBps: number;
  fillType: FillType;
  router: string;
  routeLabels: string[];
  priceImpactPct: string;
  raw: Record<string, unknown>;
}

export interface ReferenceResult {
  source: "finnhub_quote";
  price: string;
  timestamp: number;
  ageSeconds: number;
}

export interface MarketStatusResult {
  source: "finnhub_market_status";
  marketOpen: boolean;
  marketSession: MarketSession;
}

export interface ReferencePrice {
  underlying: string;
  source: "finnhub_quote" | null;
  price: string | null;
  timestamp: number | null;
  ageSeconds: number | null;
  marketOpen: boolean | null;
  marketSession: MarketSession;
  jupiterPricePerShareUsd: string | null;
  quotedPricePerShare: string;
  premiumBps: number | null;
  fillType: FillType;
}
