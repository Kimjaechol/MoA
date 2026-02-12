import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceMoaGeminiFree(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  return await applyAuthChoicePluginProvider(params, {
    authChoice: "moa-gemini-free",
    pluginId: "moa-gemini-free",
    providerId: "moa-gemini-free",
    methodId: "oauth",
    label: "MoA Gemini Free",
  });
}
