"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { LatestRequestGate } from "../lib/latest-request";
import { priceCheckSummary, priceComparisonDetail } from "../lib/presentation";
import type { ReferencePrice } from "../lib/types";

const ASSETS = {
  TSLA: { symbol: "TSLAx", mark: "T" },
  NVDA: { symbol: "NVDAx", mark: "N" },
  AAPL: { symbol: "AAPLx", mark: "A" },
  SPY: { symbol: "SPYx", mark: "S" },
  GOOGL: { symbol: "GOOGLx", mark: "G" },
} as const;

type Ticker = keyof typeof ASSETS;

interface QuoteResponse extends Record<string, unknown> {
  referencePrice: ReferencePrice;
}

interface QuoteWorkbenchProps {
  initialLatencyMs: number | null;
  initialResponse: QuoteResponse | null;
}

export default function QuoteWorkbench({ initialLatencyMs, initialResponse }: QuoteWorkbenchProps) {
  const [ticker, setTicker] = useState<Ticker>("NVDA");
  const [amount, setAmount] = useState("1000");
  const [response, setResponse] = useState<QuoteResponse | null>(initialResponse);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(initialLatencyMs);
  const requestGate = useRef(new LatestRequestGate());

  useEffect(() => {
    if (!initialResponse) void requestQuote("NVDA", "1000");
    return () => requestGate.current.invalidate();
    // The initial retry should run only once after hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jsonGroups = useMemo(() => {
    if (!response) return null;
    const { referencePrice, ...jupiter } = response;
    return { jupiter, referencePrice };
  }, [response]);

  const reference = response?.referencePrice ?? null;
  const asset = ASSETS[ticker];
  const priceCheckLines = reference
    ? priceCheckSummary(reference)
    : ["Waiting for quote", null] as const;
  const priceComparison = reference
    ? priceComparisonDetail(reference, asset.symbol)
    : { label: `${asset.symbol} premium vs. ${ticker}`, value: "Unavailable" };
  const outputAmount = formatAtomicAmount(response?.outAmount, 8, 4);
  const outputUsdValue = finiteNumber(response?.outUsdValue);

  async function requestQuote(nextTicker: Ticker, nextAmount: string) {
    const request = requestGate.current.begin();
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const result = await fetch(
        `/api/order?ticker=${encodeURIComponent(nextTicker)}&amountUsdc=${encodeURIComponent(nextAmount)}`,
        { signal: request.signal },
      );
      const body = (await result.json()) as QuoteResponse | { message?: string };

      if (!result.ok) {
        const message = "message" in body && typeof body.message === "string"
          ? body.message
          : "Quote request failed";
        throw new Error(message);
      }

      const latencyHeader = Number(result.headers.get("x-latency-ms"));
      if (!requestGate.current.isCurrent(request.id)) return;
      setLatencyMs(Number.isFinite(latencyHeader) ? latencyHeader : null);
      setResponse(body as QuoteResponse);
    } catch (requestError) {
      if (!requestGate.current.isCurrent(request.id)) return;
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setLatencyMs(null);
      setResponse(null);
      setError(requestError instanceof Error ? requestError.message : "Quote request failed");
    } finally {
      if (requestGate.current.finish(request.id)) {
        setLoading(false);
      }
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestQuote(ticker, amount);
  }

  function onTickerChange(nextTicker: Ticker) {
    setTicker(nextTicker);
    invalidateQuote();
  }

  function onAmountChange(nextAmount: string) {
    setAmount(nextAmount);
    invalidateQuote();
  }

  function invalidateQuote() {
    requestGate.current.invalidate();
    setLoading(false);
    setResponse(null);
    setLatencyMs(null);
    setError(null);
  }

  async function copyJson() {
    if (!response) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(response, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError("Clipboard access was denied by the browser");
    }
  }

  return (
    <main className="page-shell">
      <section className="page-intro" aria-labelledby="page-title">
        <h1 id="page-title">RWA Price Check</h1>
        <p>Compare a live Jupiter swap quote with its underlying US equity price</p>
      </section>

      <section className="pricing-layout" aria-label="RWA quote workbench">
        <form className={`swap-card ${loading ? "is-loading" : ""}`} onSubmit={onSubmit}>
          <div className="swap-card-top">
            <strong>Swap</strong>
            <button
              aria-label="Refresh quote"
              className="icon-button"
              disabled={loading || !amount}
              onClick={() => void requestQuote(ticker, amount)}
              type="button"
            >
              ↻
            </button>
          </div>

          <div className="swap-leg from-leg">
            <div className="leg-heading">
              <span>From <span className="network-name">· Solana</span></span>
              <span className="locked-label">Quote currency locked</span>
            </div>

            <div className="token-row">
              <span className="token-pill usdc-pill">
                <span className="token-mark">$</span>
                USDC
                <span className="lock-mark" aria-hidden="true">⌁</span>
              </span>
            </div>

            <div className="amount-row">
              <input
                aria-label="Amount in USDC"
                inputMode="decimal"
                min="10"
                max="100000"
                onChange={(event) => onAmountChange(event.target.value)}
                placeholder="0"
                required
                step="0.000001"
                type="number"
                value={amount}
              />
            </div>

            <span className="swap-direction" aria-hidden="true">↓</span>
          </div>

          <div className="swap-leg to-leg">
            <div className="leg-heading">
              <span>To <span className="network-name">· Solana</span></span>
              <span>{reference ? `1 ${asset.symbol} = ${decimal(reference.quotedPricePerShare, 2)} USDC` : "—"}</span>
            </div>

            <label className="token-pill output-token-pill">
              <span className="token-mark">{asset.mark}</span>
              <select
                aria-label="Token to receive"
                onChange={(event) => onTickerChange(event.target.value as Ticker)}
                value={ticker}
              >
                {Object.entries(ASSETS).map(([value, config]) => (
                  <option key={value} value={value}>{config.symbol}</option>
                ))}
              </select>
              <span aria-hidden="true">⌄</span>
            </label>

            <div className="amount-row output-amount-row">
              <strong>{outputAmount}</strong>
              <span>{outputUsdValue === null ? "—" : money(outputUsdValue, 2)}</span>
            </div>
          </div>

          <div className="receive-row">
            <span>You receive (incl. fee)</span>
            <strong>{response ? `${outputAmount} ${asset.symbol}` : "—"}</strong>
          </div>

          <button
            aria-controls="price-details"
            aria-expanded={detailsOpen}
            className="price-check"
            onClick={() => setDetailsOpen((open) => !open)}
            type="button"
          >
            <span className="price-check-title"><span aria-hidden="true">✓</span>RWA price check</span>
            <span className="price-check-result">
              <span className="price-check-copy">
                <span>{priceCheckLines[0]}</span>
                {priceCheckLines[1] ? <span>{priceCheckLines[1]}</span> : null}
              </span>
              <span className="price-check-chevron" aria-hidden="true">{detailsOpen ? "⌃" : "⌄"}</span>
            </span>
          </button>

          {detailsOpen ? (
            <div className="price-details" id="price-details">
              <PriceDetail
                label="Effective price per share, swap fee included"
                value={reference ? money(reference.quotedPricePerShare, 2) : "—"}
              />
              <PriceDetail
                label={`${reference?.underlying ?? ticker} stock per share price (${ageLong(reference?.ageSeconds ?? null)})`}
                value={reference?.price ? money(reference.price, 4) : "Unavailable"}
              />
              <PriceDetail
                label={priceComparison.label}
                value={priceComparison.value}
              />
              <PriceDetail
                label="U.S. stock market"
                value={reference ? marketStatusLabel(reference) : "Unavailable"}
              />
            </div>
          ) : null}

          {error ? <p className="swap-error" role="alert">{error}</p> : null}

          <div className="swap-action">
            <button disabled={loading || !amount} type="submit">
              {loading ? "Fetching quote…" : response ? "Refresh quote" : "Get quote"}
            </button>
          </div>
        </form>

        <article className="json-panel" aria-label="Full API response">
          <div className="response-status" role="status" aria-live="polite">
            <span className={`status-dot ${error ? "has-error" : response && !loading ? "is-ready" : "is-pending"}`} />
            <span>{error ? "Request failed" : loading ? "Fetching quote" : response ? "Response ready" : "Waiting for quote"}</span>
            <strong>{latencyMs === null ? "— ms" : `${latencyMs} ms`}</strong>
          </div>

          <div className="panel-heading">
            <div>
              <p>01 / Response</p>
              <h2>Full payload</h2>
            </div>
            <button className="copy-button" disabled={!response} type="button" onClick={copyJson}>
              {copied ? "Copied ✓" : "Copy JSON"}
            </button>
          </div>

          {jsonGroups ? (
            <>
              <JsonBlock label="Jupiter order" value={jsonGroups.jupiter} />
              <JsonBlock className="reference-json" label="Attached · referencePrice" value={jsonGroups.referencePrice} />
            </>
          ) : (
            <div className="json-empty">{error ?? "Choose an amount and token to request a quote."}</div>
          )}
        </article>
      </section>
    </main>
  );
}

function PriceDetail({ label, value }: { label: string; value: string }) {
  return <div className="price-detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function JsonBlock({ className = "", label, value }: { className?: string; label: string; value: unknown }) {
  return (
    <section className={`json-group ${className}`}>
      <h3>{label}</h3>
      <pre><code>{JSON.stringify(value, null, 2)}</code></pre>
    </section>
  );
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function formatAtomicAmount(
  value: unknown,
  tokenDecimals: number,
  maximumFractionDigits = tokenDecimals,
) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return "—";
  const number = Number(value) / 10 ** tokenDecimals;
  return number.toLocaleString("en-US", { maximumFractionDigits });
}

function money(value: number | string, maximumFractionDigits: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits,
      })
    : "—";
}

function decimal(value: string, maximumFractionDigits: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits })
    : "—";
}

function marketStatusLabel(reference: ReferencePrice) {
  if (reference.marketOpen === null) return "Unavailable";
  if (reference.marketOpen) return "Open";

  if (reference.marketSession === "pre-market") return "Closed · Pre-market";
  if (reference.marketSession === "post-market") return "Closed · Post-market";
  return "Closed";
}

function ageLong(seconds: number | null) {
  if (seconds === null) return "age unknown";
  return `${ageDuration(seconds)} ago`;
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
