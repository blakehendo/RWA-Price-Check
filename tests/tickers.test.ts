import { describe, expect, it } from "vitest";

import {
  getTicker,
  SUPPORTED_TICKERS,
  TICKERS,
  UnknownTickerError,
  USDC,
} from "../lib/tickers";

describe("ticker registry", () => {
  it("contains the five verified xStocks", () => {
    expect(SUPPORTED_TICKERS).toEqual(["TSLA", "NVDA", "AAPL", "SPY", "GOOGL"]);
    expect(Object.values(TICKERS).every(({ tokenDecimals }) => tokenDecimals === 8)).toBe(
      true,
    );
  });

  it("uses the verified six-decimal USDC mint", () => {
    expect(USDC).toEqual({
      symbol: "USDC",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      decimals: 6,
    });
  });

  it("normalizes a supported ticker", () => {
    expect(getTicker(" tsla ")).toMatchObject({
      tokenSymbol: "TSLAx",
      exchange: "NASDAQ",
    });
  });

  it("throws a typed error for an unknown ticker", () => {
    expect(() => getTicker("META")).toThrow(UnknownTickerError);

    try {
      getTicker("META");
    } catch (error) {
      expect(error).toMatchObject({
        name: "UnknownTickerError",
        ticker: "META",
        message: "Unknown ticker: META",
      });
    }
  });
});
