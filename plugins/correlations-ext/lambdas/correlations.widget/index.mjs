import { period, readRange, seriesFromWire, tFor, widgetData } from "./lib.mjs";

/**
 * The Correlations widget: the kernel's daily series for the days asked, the built-in's own core (lib.mjs) for the rows.
 * @param {{ config: { target?: string, days?: number, limit?: number } }} event
 */
export async function handler(event, context) {
  const config = event.config ?? {};
  const today = new Date().toLocaleDateString("sv-SE");
  const { series } = await context.zeff.call("series.read", readRange(period({ days: Number(config.days) }, today)));
  return widgetData(seriesFromWire(series), config, today, tFor(context.language));
}
