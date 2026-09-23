export type IntegrationsToolBundle = "jira" | "slack" | "google" | "inbox" | "preflight";

export const INTEGRATIONS_TOOL_BUNDLES: Record<IntegrationsToolBundle, readonly string[]> = {
  jira: [
    "atlassian-searchJiraIssuesUsingJql",
    "atlassian-getJiraIssue",
    "atlassian-getJiraIssueFields",
    "atlassian-listJiraFields",
    "atlassian-getCrqLinkedIssues",
  ],
  slack: [
    "slack-search",
    "slack-getUserInfo",
    "slack-lookupUser",
    "slack-getConversations",
    "slack-getChannelHistory",
    "slack-getDMHistory",
    "slack-getUnread",
    "slack-sendMessage",
  ],
  google: [
    "google-workspace-gmail_search",
    "google-workspace-gmail_get",
    "google-workspace-gmail_getThread",
    "google-workspace-calendar_listEvents",
  ],
  inbox: ["inbox-unread"],
  preflight: ["native_preflight_check"],
};

export const INTEGRATIONS_MANAGED_TOOL_NAMES: readonly string[] = Object.values(
  INTEGRATIONS_TOOL_BUNDLES,
).flat();

const TOOL_TO_BUNDLE = new Map<string, IntegrationsToolBundle>();
for (const [bundle, tools] of Object.entries(INTEGRATIONS_TOOL_BUNDLES) as [
  IntegrationsToolBundle,
  readonly string[],
][]) {
  for (const tool of tools) {
    if (!TOOL_TO_BUNDLE.has(tool)) TOOL_TO_BUNDLE.set(tool, bundle);
  }
}

export function integrationsBundleForTool(toolName: string): IntegrationsToolBundle | null {
  return TOOL_TO_BUNDLE.get(toolName) ?? null;
}

export function isIntegrationsManagedTool(toolName: string): boolean {
  return TOOL_TO_BUNDLE.has(toolName);
}
