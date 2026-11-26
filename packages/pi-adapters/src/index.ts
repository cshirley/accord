/**
 * Thin pi adapters over harness-neutral accord-core modules.
 * Each capability also ships as a CLI (accord-guardrail, accord-notify, gdoc-md).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import gdoc from "./gdoc/index.js";
import guardrail from "./guardrail/index.js";
import morning from "./morning/index.js";
import notify from "./notify.js";

export default function adapters(pi: ExtensionAPI) {
  guardrail(pi);
  notify(pi);
  gdoc(pi);
  morning(pi);
}
