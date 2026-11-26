/**
 * Thin pi adapters over harness-neutral accord-core modules.
 * Only capabilities that need pi lifecycle hooks live here (guardrail, notify).
 * Command-style capabilities are plain CLIs, driven by skills:
 *   accord-morning, gdoc-md.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import guardrail from "./guardrail/index.js";
import notify from "./notify.js";

export default function adapters(pi: ExtensionAPI) {
  guardrail(pi);
  notify(pi);
}
