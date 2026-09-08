import { NextResponse } from "next/server";

import {
  getOrder,
  InvalidOrderRequestError,
  parseOrderRequest,
  QuoteUnavailableError,
} from "../../../lib/order";

export const dynamic = "force-dynamic";

export function createOrderHandler(orderService: typeof getOrder = getOrder) {
  return async function handleOrder(request: Request) {
    try {
      const orderRequest = parseOrderRequest(new URL(request.url).searchParams);
      const result = await orderService(orderRequest);
      return NextResponse.json(result.body, {
        headers: { "X-Latency-Ms": String(result.meta.latencyMs) },
      });
    } catch (error) {
      if (error instanceof InvalidOrderRequestError) {
        return NextResponse.json(
          { error: error.code, message: error.message },
          { status: 400 },
        );
      }

      if (error instanceof QuoteUnavailableError) {
        return NextResponse.json(
          { error: "QUOTE_UNAVAILABLE", message: error.message },
          { status: 502 },
        );
      }

      console.error("Unexpected order route failure", error);
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "The order request could not be completed" },
        { status: 500 },
      );
    }
  };
}

const handleOrder = createOrderHandler();

export async function GET(request: Request) {
  return handleOrder(request);
}
