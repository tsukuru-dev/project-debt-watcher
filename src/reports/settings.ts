import type { GraveyardArguments } from "../commands/arguments.js";
import type { ConfigurationDocument } from "../config/types.js";
import { validateConfiguration } from "../config/validate.js";

/** Resolve report-only overrides without changing the saved repository configuration. */
export function resolveReportSettings(saved: ConfigurationDocument, options: GraveyardArguments): ConfigurationDocument {
  const effective: Record<string, unknown> = { ...saved };
  if (options.fresh !== undefined) effective.fresh = options.fresh;
  if (options.ageing !== undefined) effective.ageing = options.ageing;
  if (options.buried !== undefined) effective.buried = options.buried;
  if (options.fresh !== undefined && options.ageing === undefined && options.buried === undefined) {
    delete effective.ageing;
    delete effective.buried;
  }
  if (options.markers !== undefined) effective.markers = [...options.markers];
  if (options.order !== undefined) effective.order = options.order;
  if (options.filter?.includeFresh !== undefined) effective.includeFresh = options.filter.includeFresh;
  return validateConfiguration(effective);
}
