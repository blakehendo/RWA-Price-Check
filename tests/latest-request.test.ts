import { describe, expect, it } from "vitest";

import { LatestRequestGate } from "../lib/latest-request";

describe("quote workbench request ordering", () => {
  it("never commits a slow response after a newer request has started", async () => {
    const gate = new LatestRequestGate();
    const firstResponse = deferred<string>();
    const secondResponse = deferred<string>();
    const displayed: string[] = [];

    const firstRun = runRequest(gate, firstResponse.promise, displayed);
    const secondRun = runRequest(gate, secondResponse.promise, displayed);

    secondResponse.resolve("NVDA:1000");
    await secondRun;
    firstResponse.resolve("TSLA:100");
    await firstRun;

    expect(displayed).toEqual(["NVDA:1000"]);
  });
});

async function runRequest(
  gate: LatestRequestGate,
  response: Promise<string>,
  displayed: string[],
) {
  const request = gate.begin();
  const value = await response;
  if (gate.isCurrent(request.id)) displayed.push(value);
  gate.finish(request.id);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
