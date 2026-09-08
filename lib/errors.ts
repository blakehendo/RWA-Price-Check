export type UpstreamSource = "jupiter" | "finnhub";

export class UpstreamError extends Error {
  readonly source: UpstreamSource;
  readonly status: number;

  constructor(source: UpstreamSource, status: number) {
    super(`${source} returned HTTP ${status}`);
    this.name = "UpstreamError";
    this.source = source;
    this.status = status;
  }
}

export class UpstreamTimeout extends Error {
  readonly source: UpstreamSource;
  readonly timeoutMs: number;

  constructor(source: UpstreamSource, timeoutMs: number) {
    super(`${source} timed out after ${timeoutMs}ms`);
    this.name = "UpstreamTimeout";
    this.source = source;
    this.timeoutMs = timeoutMs;
  }
}

export class UpstreamRateLimited extends UpstreamError {
  readonly retryAfterSeconds: number | null;

  constructor(source: UpstreamSource, retryAfterSeconds: number | null = null) {
    super(source, 429);
    this.name = "UpstreamRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MissingConfigurationError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingConfigurationError";
    this.variable = variable;
  }
}
