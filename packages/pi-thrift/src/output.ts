/**
 * Output token pruning — reduce what the LLM produces.
 *
 * Injects a system-prompt fragment that instructs the model to maximise
 * information density while keeping full technical accuracy.  Inspired by
 * pi-caveman by @jonjonrankin (https://github.com/jonjonrankin/pi-caveman).
 *
 * Levels: off → lite → full → ultra
 *
 * Commands are registered by index.ts under the /thrift namespace.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { OUTPUT_LEVELS, type OutputLevel, saveConfig, type ThriftConfig } from "./config.js";

// ── System prompt fragments ─────────────────────────────────────────────

const BASE = `\
IMPORTANT: TERSE MODE is active.  Maximise information density — every token \
must earn its place.  All technical substance stays; only verbal padding is cut.

Rules:
- Cut: articles (a/an/the), filler (just/really/basically/actually/simply), \
pleasantries (sure/certainly/happy to), hedging (might/perhaps/I think), apologies
- Keep exact: technical terms, code blocks, error messages, file paths, \
config values, command syntax, numeric data
- Prefer: fragments over full sentences, short synonyms, direct assertions
- Pattern: [thing] [state/action] [reason if needed]. [next step].
- Never compress: code, shell commands, paths, error output, config snippets

Bad: "Sure! I'd be happy to help you with that. The issue you're experiencing \
is likely caused by a race condition in the authentication middleware, where \
the token expiry check is using a strict less-than operator."
Good: "Race condition in auth middleware. Token expiry check uses \`<\` not \
\`<=\` — off-by-one lets expired tokens through. Fix:"`;

const INTENSITY: Record<Exclude<OutputLevel, "off">, string> = {
  lite: `\
Professional and tight. Remove filler and hedging but keep articles, pronouns, \
and grammatically complete sentences.
Example — verbose: "I think the component is re-rendering because you're \
creating a new object reference on each render cycle."
Example — terse: "Component re-renders because a new object reference is \
created each render. Wrap the prop in \`useMemo\`."`,

  full: `\
Drop articles and pronouns where unambiguous. Sentence fragments are fine. \
Choose shorter synonyms.
Example: "New object ref each render. Inline object prop = new ref = \
re-render. Wrap in \`useMemo\`."`,

  ultra: `\
Maximum compression. Abbreviate common terms (DB/auth/config/req/res/fn/impl/dep/env/pkg) \
after writing them out once. Cut every word that does not change the meaning.
Keep causal explanations as clauses, not symbol chains: a reader who has to decode \
"A → B → C" spends more time than the arrows saved. Compression that costs a re-read \
is not compression.
Example: "Inline object prop creates a new ref each render, so the child re-renders. \
Wrap in \`useMemo\`."`,
};

const SAFETY = `\
Auto-clarity: temporarily switch to normal verbosity for security warnings, \
irreversible-action confirmations, or when the user appears confused. \
Resume terse mode after.
Boundaries: write normal code and commands — only compress natural-language \
explanations and commentary.  "normal mode" or "verbose" in a user message \
disables terse mode for that response.`;

// ── Animation (256-color fire palette) ──────────────────────────────────

interface Animation {
  frames: string[];
  label: string;
  interval: number;
}

const R = "\x1b[38;5;196m";
const O = "\x1b[38;5;208m";
const Y = "\x1b[38;5;220m";
const W = "\x1b[38;5;230m";
const E = "\x1b[38;5;52m";
const X = "\x1b[0m";

const FIRE_FRAMES = [
  `${R}⠠${O}⠄${X}`,
  `${O}⠔${Y}⠂${X}`,
  `${Y}⠊${W}⠑${X}`,
  `${W}⠑${Y}⠊${X}`,
  `${Y}⠂${O}⠔${X}`,
  `${O}⠄${R}⠠${X}`,
  `${R}⠠${E}⠄${X}`,
  `${E}⠔${R}⠂${X}`,
];

const ANIMATIONS: Record<Exclude<OutputLevel, "off">, Animation> = {
  lite: { frames: FIRE_FRAMES, label: "LITE", interval: 300 },
  full: { frames: FIRE_FRAMES, label: "FULL", interval: 200 },
  ultra: { frames: FIRE_FRAMES, label: "ULTRA", interval: 100 },
};

export const OUTPUT_LEVEL_OPTIONS = [
  { value: "lite", label: "lite", description: "Professional, no fluff" },
  { value: "full", label: "full", description: "Classic terse — fragments, short synonyms" },
  { value: "ultra", label: "ultra", description: "Maximum compression — abbreviations, no filler" },
  { value: "off", label: "off", description: "Disable output pruning" },
  { value: "stop", label: "stop", description: "Disable output pruning" },
  { value: "quit", label: "quit", description: "Disable output pruning" },
] as const;

// ── Public handle (used by index.ts) ────────────────────────────────────

export interface OutputHandle {
  getLevel(): OutputLevel;
  setLevel(level: OutputLevel): void;
  syncStatus(ctx: Pick<ExtensionContext, "ui">): void;
  /** Open the interactive config dialog (called by index.ts command). */
  openConfig(ctx: ExtensionContext): Promise<void>;
}

// ── Registration ────────────────────────────────────────────────────────

export function registerOutputPruning(pi: ExtensionAPI, config: ThriftConfig): OutputHandle {
  let level: OutputLevel = config.output.level;
  let timer: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;
  let isActive = false;

  // -- Animation helpers --------------------------------------------------

  function stopAnimation() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    frameIndex = 0;
  }

  function syncStatus(ctx: Pick<ExtensionContext, "ui">) {
    stopAnimation();
    const theme = ctx.ui.theme;

    if (!config.enabled || level === "off" || !config.showStatus) {
      ctx.ui.setStatus("thrift-output", "");
      return;
    }

    const anim = ANIMATIONS[level];
    const setFrame = (frame: string) => {
      ctx.ui.setStatus(
        "thrift-output",
        `${frame} ${theme.fg("muted", "terse ")}${theme.fg("text", anim.label)}`,
      );
    };

    if (!isActive) {
      const frame0 = anim.frames[0];
      if (frame0 !== undefined) setFrame(frame0);
      return;
    }

    const renderFrame = () => {
      const len = anim.frames.length;
      if (len === 0) return;
      const frame = anim.frames[frameIndex % len];
      if (frame !== undefined) setFrame(frame);
      frameIndex++;
    };
    renderFrame();
    timer = setInterval(renderFrame, anim.interval);
  }

  // -- Hooks --------------------------------------------------------------

  pi.on("before_agent_start", async (event) => {
    if (!config.enabled || level === "off") return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${BASE}\n\n${INTENSITY[level]}\n\n${SAFETY}`,
    };
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (!config.enabled) return;
    isActive = true;
    syncStatus(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    isActive = false;
    if (!config.enabled) return;
    syncStatus(ctx);
  });

  // No config.enabled guard — always clean up timers on shutdown.
  pi.on("session_shutdown", async () => {
    stopAnimation();
    isActive = false;
  });

  // -- Config dialog (invoked by index.ts command) ------------------------

  async function openConfig(ctx: ExtensionContext) {
    await ctx.ui.custom((_tui, theme, _kb, done) => {
      const items: SettingItem[] = [
        {
          id: "enabled",
          label: "Extension enabled",
          currentValue: config.enabled ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "defaultLevel",
          label: "Default level for new sessions",
          currentValue: config.output.level,
          values: [...OUTPUT_LEVELS],
        },
        {
          id: "showStatus",
          label: "Show status indicators",
          currentValue: config.showStatus ? "on" : "off",
          values: ["on", "off"],
        },
      ];

      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold(" Thrift Config")), 0, 0));
      container.addChild(new Text(theme.fg("dim", " Saved to ~/.pi/agent/thrift.json"), 0, 0));
      container.addChild(new Text("", 0, 0));

      const applyChange = (id: string, newValue: string) => {
        if (id === "enabled") {
          config.enabled = newValue === "on";
          if (!config.enabled) {
            ctx.ui.setStatus("thrift", "");
          }
        } else if (id === "defaultLevel" && OUTPUT_LEVELS.includes(newValue as OutputLevel)) {
          config.output.level = newValue as OutputLevel;
        } else if (id === "showStatus") {
          config.showStatus = newValue === "on";
          if (!config.showStatus) {
            ctx.ui.setStatus("thrift", "");
          }
        }
        saveConfig(config);
        syncStatus(ctx);
      };

      const settingsList = new SettingsList(
        items,
        Math.min(items.length + 2, 10),
        getSettingsListTheme(),
        applyChange,
        () => done(undefined),
      );

      container.addChild(settingsList);
      container.addChild(
        new Text(theme.fg("dim", " ←→/hl/tab change • ↑↓/jk move • esc close"), 0, 0),
      );

      const cycleValue = (dir: -1 | 1) => {
        const rawList = settingsList as unknown as Record<string, unknown>;
        const idx = rawList.selectedIndex;
        if (typeof idx !== "number") return;
        const item = items[idx];
        if (!item?.values?.length) return;
        const cur = item.values.indexOf(item.currentValue);
        const next = (cur + dir + item.values.length) % item.values.length;
        const newVal = item.values[next];
        if (newVal === undefined) return;
        item.currentValue = newVal;
        settingsList.updateValue(item.id, newVal);
        applyChange(item.id, newVal);
      };

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (data === "j") data = "\u001b[B";
          else if (data === "k") data = "\u001b[A";
          else if (data === "h" || data === "\u001b[D") {
            cycleValue(-1);
            _tui.requestRender();
            return;
          } else if (data === "l" || data === "\u001b[C" || data === "\t") {
            cycleValue(1);
            _tui.requestRender();
            return;
          }
          settingsList.handleInput?.(data);
          _tui.requestRender();
        },
      };
    });
  }

  // -- Return handle for index.ts -----------------------------------------

  return {
    getLevel: () => level,
    setLevel: (l: OutputLevel) => {
      level = l;
    },
    syncStatus: (ctx: Pick<ExtensionContext, "ui">) => syncStatus(ctx),
    openConfig,
  };
}
