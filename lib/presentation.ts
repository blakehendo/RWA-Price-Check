import type { ReferencePrice } from "./types";

export function priceCheckSummary(reference: ReferencePrice) {
  if (reference.premiumBps === null) {
    return ["Stock price unavailable", "No comparison"] as const;
  }

  const comparison = reference.premiumBps < 0
    ? `${unsignedPercent(reference.premiumBps / 100)} discount vs ${reference.underlying}`
    : `${signedPercent(reference.premiumBps / 100)} premium vs ${reference.underlying}`;
  const priceAge = reference.ageSeconds === null
    ? "Stock price age unavailable"
    : `Stock price is ${ageDuration(reference.ageSeconds)} old`;
  return [comparison, priceAge] as const;
}

export function priceComparisonDetail(reference: ReferencePrice, assetSymbol: string) {
  const isDiscount = reference.premiumBps !== null && reference.premiumBps < 0;

  return {
    label: `${assetSymbol} ${isDiscount ? "discount" : "premium"} vs. ${reference.underlying}`,
    value: reference.premiumBps === null
      ? "Unavailable"
      : isDiscount
        ? unsignedPercent(reference.premiumBps / 100)
        : signedPercent(reference.premiumBps / 100),
  };
}

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function unsignedPercent(value: number) {
  return `${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function ageDuration(seconds: number) {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  if (seconds < 3_600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.floor(seconds / 3_600);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
