/**
 * Tool integrations for pi — auto-registers all tool defs and commands.
 *
 * To add a new tool:
 *   1. Create a file in defs/ exporting defineTool({ ... })
 *   2. Import it here and add to the toolDefs array
 *
 * To add setup/status commands:
 *   1. Create a file in commands/ exporting defineCommands("service", { ... })
 *   2. Import it here and add to the commandSets array
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import googleCommands from "./commands/google.commands.js";
// Command sets — setup/status per service
import jiraCommands from "./commands/jira.commands.js";
import slackCommands from "./commands/slack.commands.js";
import calendarEvents from "./defs/calendar-events.js";
import gmailGet from "./defs/gmail-get.js";
import gmailSearch from "./defs/gmail-search.js";
import gmailThread from "./defs/gmail-thread.js";
import inboxUnread from "./defs/inbox-unread.js";
import jiraCrqChanges from "./defs/jira-crq-changes.js";
import jiraGet from "./defs/jira-get.js";
import jiraGetFields from "./defs/jira-get-fields.js";
import jiraListFields from "./defs/jira-list-fields.js";
// Tool definitions — one per file
import jiraSearch from "./defs/jira-search.js";
import preflight from "./defs/preflight.js";
import slackChannelHistory from "./defs/slack-channel-history.js";
import slackConversations from "./defs/slack-conversations.js";
import slackDmHistory from "./defs/slack-dm-history.js";
import slackSearch from "./defs/slack-search.js";
import slackSend from "./defs/slack-send.js";
import slackUnread from "./defs/slack-unread.js";
import slackUserInfo from "./defs/slack-user-info.js";
import slackUserLookup from "./defs/slack-user-lookup.js";
import { registerCommands, registerToolDefs } from "./framework.js";
import { resetMcpRegistry } from "./mcp-registry.js";

export default function tools(pi: ExtensionAPI) {
  const toolDefs = [
    // Jira
    jiraSearch,
    jiraGet,
    jiraGetFields,
    jiraListFields,
    jiraCrqChanges,
    // Google Workspace
    gmailSearch,
    gmailGet,
    gmailThread,
    calendarEvents,
    // Slack
    slackSearch,
    slackUserInfo,
    slackUserLookup,
    slackConversations,
    slackChannelHistory,
    slackDmHistory,
    slackUnread,
    slackSend,
    // Unified inbox
    inboxUnread,
    // Preflight
    preflight,
  ];

  registerToolDefs(pi, toolDefs);

  registerCommands(pi, [jiraCommands, slackCommands, googleCommands]);

  pi.on("session_shutdown", () => resetMcpRegistry());

  console.log(`🔗 Tools loaded: ${toolDefs.length} tools, ${3} services`);
}
