/**
 * Discriminated `Result<T, E>` for core query / mutation functions.
 *
 * Adapters translate the `ok` discriminant into their host-specific
 * envelope (Pi `AgentToolResult`, MCP `content[]`, etc.). Internal
 * callers should narrow with `result.ok` rather than `"error" in result`.
 */

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
