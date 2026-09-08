# Capture metadata

- Request: `GET https://finnhub.io/api/v1/stock/market-status?exchange=US` authenticated with the `X-Finnhub-Token` header
- HTTP status: `200`
- Response `Date` header: `Thu, 03 Sep 2026 22:01:33 GMT`
- Capture timestamp source: upstream HTTP `Date` response header
- Observation: Finnhub reported `session: "post-market"` and `isOpen: false`; the session timestamp was `1788472938`.
