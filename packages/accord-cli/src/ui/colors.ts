/**
 * Minimal ANSI styling for accord-cli (no extra deps).
 * Respects NO_COLOR, FORCE_COLOR, and TTY detection.
 */

export type ColorName =
  | "reset"
  | "bold"
  | "dim"
  | "cyan"
  | "green"
  | "yellow"
  | "red"
  | "magenta"
  | "blue"
  | "gray"
  | "white";

const ANSI: Record<ColorName, string> = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
};

let colorEnabled =
  process.env.NO_COLOR === undefined &&
  (process.env.FORCE_COLOR !== undefined || Boolean(process.stdout.isTTY || process.stderr.isTTY));

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled && process.env.NO_COLOR === undefined;
}

export function colorsEnabled(): boolean {
  return colorEnabled;
}

export function paint(color: ColorName, text: string): string {
  if (!colorEnabled || color === "reset") return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

export function bold(text: string): string {
  return paint("bold", text);
}

export function dim(text: string): string {
  return paint("dim", text);
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function padVisible(text: string, width: number): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  return text + " ".repeat(width - visible);
}

export function heading(text: string): string {
  return bold(paint("cyan", text));
}

export function success(text: string): string {
  return paint("green", text);
}

export function warn(text: string): string {
  return paint("yellow", text);
}

export function error(text: string): string {
  return paint("red", text);
}

export function muted(text: string): string {
  return paint("gray", text);
}

export function accent(text: string): string {
  return paint("magenta", text);
}
