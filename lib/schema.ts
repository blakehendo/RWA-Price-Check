import { z } from "zod";

import type { ReferencePrice } from "./types";

const marketSessionSchema = z.enum([
  "pre-market",
  "regular",
  "post-market",
  "closed",
  "unknown",
]);

export const referencePriceSchema: z.ZodType<ReferencePrice> = z
  .object({
    underlying: z.string().min(1),
    source: z.literal("finnhub_quote").nullable(),
    price: z.string().nullable(),
    timestamp: z.number().int().nonnegative().nullable(),
    ageSeconds: z.number().int().nonnegative().nullable(),
    marketOpen: z.boolean().nullable(),
    marketSession: marketSessionSchema,
    jupiterPricePerShareUsd: z.string().nullable(),
    quotedPricePerShare: z.string(),
    premiumBps: z.number().int().nullable(),
    fillType: z.enum(["rfq", "amm"]),
  })
  .strict();
