/** `workItemId` scopes the lookup: task ids repeat across work items, so a resolver must not guess. */
export type PrGroupResolver = (taskId: number, workItemId?: string) => number[];

const defaultResolver: PrGroupResolver = (taskId) => [taskId];
let prGroupResolver: PrGroupResolver = defaultResolver;

/** Registers the resolver mapping a task to the tasks of its PR (last registration wins). */
export function registerPrGroupResolver(resolver: PrGroupResolver): void {
  prGroupResolver = resolver;
}

export function resolvePrGroup(taskId: number, workItemId?: string): number[] {
  return prGroupResolver(taskId, workItemId);
}

export type CloseoutBranchHook = (...args: unknown[]) => unknown;

let closeoutBranchHook: CloseoutBranchHook | undefined;

export function registerCloseoutBranchHook(hook: CloseoutBranchHook | undefined): void {
  closeoutBranchHook = hook;
}

export function getCloseoutBranchHook(): CloseoutBranchHook | undefined {
  return closeoutBranchHook;
}
