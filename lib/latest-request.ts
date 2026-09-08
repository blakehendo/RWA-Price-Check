export interface ActiveRequest {
  id: number;
  signal: AbortSignal;
}

export class LatestRequestGate {
  private sequence = 0;
  private controller: AbortController | null = null;

  begin(): ActiveRequest {
    this.controller?.abort();
    this.controller = new AbortController();
    return { id: ++this.sequence, signal: this.controller.signal };
  }

  invalidate(): void {
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
  }

  isCurrent(id: number): boolean {
    return id === this.sequence;
  }

  finish(id: number): boolean {
    if (!this.isCurrent(id)) return false;
    this.controller = null;
    return true;
  }
}
