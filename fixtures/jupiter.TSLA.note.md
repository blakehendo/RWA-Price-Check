# Capture metadata

- Request: `GET https://lite-api.jup.ag/ultra/v1/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB&amount=1000000000`
- HTTP status: `200`
- Response `Date` header: `Thu, 03 Sep 2026 21:37:20 GMT`
- Capture timestamp source: upstream HTTP `Date` response header
- Observation: `outAmount`, `swapType`, `router`, `feeBps`, and `routePlan` are present. `swapType` is `aggregator`, and the route is Riptide through the `metis` router.
