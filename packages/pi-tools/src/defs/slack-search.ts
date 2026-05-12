import { getSlackAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import { makeSlackRequest, type SlackSearchResponse } from "../services/slack.client.js";

export default defineTool<
  { query: string; sort?: string; sort_dir?: string; count?: number; highlight?: boolean },
  {
    total: number;
    messages: Array<{ text: string; user: string; channel: string; permalink: string }>;
  }
>({
  name: "slack-search",
  label: "Slack Search",
  description: "Search Slack messages, channels, and users",

  params: {
    query: {
      type: "string",
      required: true,
      description: "Search query (supports Slack search syntax)",
    },
    sort: { type: "string", default: "timestamp", description: "Sort order: timestamp or score" },
    sort_dir: { type: "string", default: "desc", description: "Sort direction: asc or desc" },
    count: { type: "number", default: 20, description: "Number of results to return" },
    highlight: { type: "boolean", default: true, description: "Enable search term highlighting" },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: (p) => `Searching Slack: ${p.query}`,

  async execute(p) {
    const resp: SlackSearchResponse = await makeSlackRequest("search.messages", {
      query: p.query,
      sort: p.sort || "timestamp",
      sort_dir: p.sort_dir || "desc",
      count: p.count || 20,
      highlight: p.highlight !== false,
    });

    const messages = resp.messages.matches.map((m) => ({
      text: m.text,
      user: m.user,
      channel: m.channel.name || m.channel.id,
      permalink: m.permalink,
    }));

    return { total: resp.messages.total, messages };
  },

  format(result) {
    const lines = result.messages
      .map((m) => `  • [${m.channel}] ${m.user}: "${m.text.slice(0, 120)}" — ${m.permalink}`)
      .join("\n");
    return {
      text: `Found ${result.total} messages (showing ${result.messages.length}):\n${lines}`,
      details: result,
    };
  },
});
