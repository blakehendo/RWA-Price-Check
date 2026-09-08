# Capture metadata

- Request: `GET https://finnhub.io/api/v1/quote?symbol=TSLA` authenticated with the `X-Finnhub-Token` header
- HTTP status: `200`
- Response `Date` header: `Thu, 03 Sep 2026 22:01:35 GMT`
- Capture timestamp source: upstream HTTP `Date` response header
- Quote timestamp `t`: `1788465600` (`Thu, 03 Sep 2026 16:00:00 ET`)
- Observation: the request was made at 18:01 ET during post-market, but `t` remained at the 16:00 ET regular close. In this capture, `c` did not represent a fresh post-market print.
