import {
  buildLoaderActiveSet,
  isProgressiveToolsEnabled,
  registerSearchableTools,
  registerToolsMatchedHandler,
  SEARCH_ACCORD_TOOLS,
} from "@clive.shirley/accord-core/tools/progressive-discovery.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type IntegrationsToolBundle,
  INTEGRATIONS_TOOL_BUNDLES,
  INTEGRATIONS_MANAGED_TOOL_NAMES,
  integrationsBundleForTool,
  isIntegrationsManagedTool,
} from "./tool-bundles.js";

const PACKAGE_ENV = "PI_INTEGRATIONS_DYNAMIC_TOOLS";

let activatedBundles = new Set<IntegrationsToolBundle>();

function integrationsDynamicEnabled(): boolean {
  return isProgressiveToolsEnabled(PACKAGE_ENV);
}

function managedIntegrationsSet(): Set<string> {
  return new Set(INTEGRATIONS_MANAGED_TOOL_NAMES);
}

function toolsForBundles(bundles: ReadonlySet<IntegrationsToolBundle>): string[] {
  const names = new Set<string>();
  for (const bundle of bundles) {
    for (const tool of INTEGRATIONS_TOOL_BUNDLES[bundle]) {
      names.add(tool);
    }
  }
  return [...names];
}

export function activateIntegrationBundles(bundles: IntegrationsToolBundle[]): void {
  for (const bundle of bundles) activatedBundles.add(bundle);
}

export function applyIntegrationsActiveTools(pi: ExtensionAPI): void {
  if (!integrationsDynamicEnabled()) return;

  const names = new Set<string>();
  for (const tool of pi.getActiveTools()) {
    if (!isIntegrationsManagedTool(tool)) names.add(tool);
  }
  for (const tool of toolsForBundles(activatedBundles)) {
    names.add(tool);
  }
  names.add(SEARCH_ACCORD_TOOLS);
  pi.setActiveTools([...names]);
}

export function applyIntegrationsSessionStart(pi: ExtensionAPI): void {
  if (!integrationsDynamicEnabled()) return;
  activatedBundles = new Set();
  pi.setActiveTools(buildLoaderActiveSet(pi.getActiveTools(), managedIntegrationsSet()));
}

export function maybeActivateIntegrationsToolCall(pi: ExtensionAPI, toolName: string): boolean {
  if (!integrationsDynamicEnabled() || !isIntegrationsManagedTool(toolName)) return false;
  const bundle = integrationsBundleForTool(toolName);
  if (!bundle || activatedBundles.has(bundle)) return false;
  activateIntegrationBundles([bundle]);
  applyIntegrationsActiveTools(pi);
  return true;
}

export function initIntegrationsDynamicTools(pi: ExtensionAPI): void {
  registerSearchableTools(INTEGRATIONS_MANAGED_TOOL_NAMES);

  registerToolsMatchedHandler((toolNames) => {
    const bundles: IntegrationsToolBundle[] = [];
    for (const name of toolNames) {
      const bundle = integrationsBundleForTool(name);
      if (bundle) bundles.push(bundle);
    }
    if (bundles.length > 0) {
      activateIntegrationBundles(bundles);
      applyIntegrationsActiveTools(pi);
    }
  });

  pi.on("session_start", () => {
    applyIntegrationsSessionStart(pi);
  });

  pi.on("tool_call", async (event) => {
    maybeActivateIntegrationsToolCall(pi, event.toolName);
  });
}
