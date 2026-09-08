import { getOrder } from "../lib/order";
import QuoteWorkbench from "./quote-workbench";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  try {
    const initial = await getOrder({ ticker: "NVDA", amountUsdc: "1000" });
    return (
      <QuoteWorkbench
        initialLatencyMs={initial.meta.latencyMs}
        initialResponse={initial.body}
      />
    );
  } catch {
    return <QuoteWorkbench initialLatencyMs={null} initialResponse={null} />;
  }
}
