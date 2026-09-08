export const USDC = {
  symbol: "USDC",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
} as const;

export interface TickerConfig {
  underlying: string;
  tokenSymbol: string;
  mint: string;
  exchange: string;
  issuer: "backed";
  tokenDecimals: 8;
  multiplier: "1.0";
}

export const TICKERS = {
  TSLA: {
    underlying: "TSLA",
    tokenSymbol: "TSLAx",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    exchange: "NASDAQ",
    issuer: "backed",
    tokenDecimals: 8,
    multiplier: "1.0",
  },
  NVDA: {
    underlying: "NVDA",
    tokenSymbol: "NVDAx",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    exchange: "NASDAQ",
    issuer: "backed",
    tokenDecimals: 8,
    multiplier: "1.0",
  },
  AAPL: {
    underlying: "AAPL",
    tokenSymbol: "AAPLx",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    exchange: "NASDAQ",
    issuer: "backed",
    tokenDecimals: 8,
    multiplier: "1.0",
  },
  SPY: {
    underlying: "SPY",
    tokenSymbol: "SPYx",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    exchange: "NYSE Arca",
    issuer: "backed",
    tokenDecimals: 8,
    multiplier: "1.0",
  },
  GOOGL: {
    underlying: "GOOGL",
    tokenSymbol: "GOOGLx",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    exchange: "NASDAQ",
    issuer: "backed",
    tokenDecimals: 8,
    multiplier: "1.0",
  },
} as const satisfies Record<string, TickerConfig>;

export type Ticker = keyof typeof TICKERS;

export const SUPPORTED_TICKERS = Object.keys(TICKERS) as Ticker[];

export class UnknownTickerError extends Error {
  readonly ticker: string;

  constructor(ticker: string) {
    super(`Unknown ticker: ${ticker}`);
    this.name = "UnknownTickerError";
    this.ticker = ticker;
  }
}

export function isTicker(value: string): value is Ticker {
  return Object.hasOwn(TICKERS, value);
}

export function getTicker(value: string): (typeof TICKERS)[Ticker] {
  const normalized = value.trim().toUpperCase();

  if (!isTicker(normalized)) {
    throw new UnknownTickerError(value);
  }

  return TICKERS[normalized];
}
