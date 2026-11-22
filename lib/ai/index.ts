import { aiSettings } from "./config";
import { hkuProvider } from "./hku";
import { simulatedProvider } from "./simulated";
import type { AiProvider } from "./types";

/**
 * One shared interface, chosen by AI_PROVIDER. There is NO silent fallback: if the live provider is selected and its settings are
 * missing or fail, the facilitator sees a clear error and nothing is made up by the simulator.
 */
export function getProvider(): AiProvider {
  return aiSettings().provider === "hku" ? hkuProvider : simulatedProvider;
}
