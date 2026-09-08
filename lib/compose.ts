import { referencePriceSchema } from "./schema";
import { getTicker, USDC } from "./tickers";
import type {
  MarketStatusResult,
  QuoteResult,
  ReferencePrice,
  ReferenceResult,
} from "./types";

const TOKEN_PRICE_DECIMALS = 8;

export function compose(
  quote: QuoteResult,
  reference: ReferenceResult | null,
  marketStatus: MarketStatusResult | null,
  ticker: string,
): ReferencePrice {
  const config = getTicker(ticker);
  const quotedPricePerShare = divideToDecimal(
    BigInt(quote.inAmount) * powerOfTen(config.tokenDecimals),
    BigInt(quote.outAmount) * powerOfTen(USDC.decimals),
    TOKEN_PRICE_DECIMALS,
  );
  const jupiterPricePerShareUsd = quote.outUsdValue === null
    ? null
    : usdValuePerShare(quote.outUsdValue, quote.outAmount, config.tokenDecimals);
  const premiumBps = reference
    ? calculatePremiumBps(quotedPricePerShare, reference.price)
    : null;

  return referencePriceSchema.parse({
    underlying: config.underlying,
    source: reference?.source ?? null,
    price: reference?.price ?? null,
    timestamp: reference?.timestamp ?? null,
    ageSeconds: reference?.ageSeconds ?? null,
    marketOpen: marketStatus?.marketOpen ?? null,
    marketSession: marketStatus?.marketSession ?? "unknown",
    jupiterPricePerShareUsd,
    quotedPricePerShare,
    premiumBps,
    fillType: quote.fillType,
  });
}

function usdValuePerShare(
  outUsdValue: number,
  outAmount: string,
  tokenDecimals: number,
): string {
  if (!Number.isFinite(outUsdValue) || outUsdValue < 0) {
    throw new RangeError("Jupiter outUsdValue must be a non-negative finite number");
  }

  const decimal = parseDecimal(String(outUsdValue));
  return divideToDecimal(
    decimal.units * powerOfTen(tokenDecimals),
    BigInt(outAmount) * powerOfTen(decimal.scale),
    TOKEN_PRICE_DECIMALS,
  );
}

export function calculatePremiumBps(quoted: string, fair: string): number {
  const quotedDecimal = parseDecimal(quoted);
  const fairDecimal = parseDecimal(fair);
  const scale = Math.max(quotedDecimal.scale, fairDecimal.scale);
  const quotedUnits = quotedDecimal.units * powerOfTen(scale - quotedDecimal.scale);
  const fairUnits = fairDecimal.units * powerOfTen(scale - fairDecimal.scale);

  if (fairUnits <= 0) throw new RangeError("Fair value must be positive");

  return Number(divideRounded((quotedUnits - fairUnits) * BigInt(10_000), fairUnits));
}

function divideToDecimal(numerator: bigint, denominator: bigint, scale: number): string {
  if (denominator <= 0) throw new RangeError("Quote outAmount must be positive");
  const units = divideRounded(numerator * powerOfTen(scale), denominator);
  return formatDecimal(units, scale);
}

function parseDecimal(value: string): { units: bigint; scale: number } {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new RangeError(`Invalid decimal value: ${value}`);
  }

  const [whole, fraction = ""] = value.split(".");
  return {
    units: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function formatDecimal(units: bigint, scale: number): string {
  const negative = units < 0;
  const absolute = negative ? -units : units;
  const divisor = powerOfTen(scale);
  const whole = absolute / divisor;
  const rawFraction = (absolute % divisor).toString().padStart(scale, "0");
  const trimmedFraction = rawFraction.replace(/0+$/, "");
  const fraction = trimmedFraction.padEnd(2, "0");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / BigInt(2)) / denominator;
  return negative ? -rounded : rounded;
}

function powerOfTen(exponent: number): bigint {
  return BigInt(10) ** BigInt(exponent);
}
