export type PrGroupResolver = (taskId: number) => number[];

const defaultResolver: PrGroupResolver = (taskId) => [taskId];
let prGroupResolver: PrGroupResolver = defaultResolver;

/** Registers the resolver mapping a task to the tasks of its PR (last registration wins). */
export function registerPrGroupResolver(resolver: PrGroupResolver): void {
  prGroupResolver = resolver;
}

export function resolvePrGroup(taskId: number): number[] {
  return prGroupResolver(taskId);
}

export type CloseoutBranchHook = (...args: unknown[]) => unknown;

let closeoutBranchHook: CloseoutBranchHook | undefined;

export function registerCloseoutBranchHook(hook: CloseoutBranchHook | undefined): void {
  closeoutBranchHook = hook;
}

export function getCloseoutBranchHook(): CloseoutBranchHook | undefined {
  return closeoutBranchHook;
}
