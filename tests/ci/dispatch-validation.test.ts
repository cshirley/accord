import { describe, expect, test } from "bun:test";

import {
  MissingDispatchFieldError,
  readDispatch,
  type GithubEventPayload,
} from "../../scripts/ci/dispatch.js";

describe("readDispatch (AC-1, TC-20)", () => {
  test("(a) workflow_call with inputs.ticket → returns { ticket, statusAtTrigger: null }", () => {
    const payload: GithubEventPayload = {
      eventName: "workflow_call",
      inputs: { ticket: "PROJ-123" },
    };
    expect(readDispatch(payload)).toEqual({
      ticket: "PROJ-123",
      statusAtTrigger: null,
    });
  });

  test("(b) repository_dispatch with client_payload.ticket + status_at_trigger → returns both", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { ticket: "PROJ-456", status_at_trigger: "Ready for Autopilot" },
    };
    expect(readDispatch(payload)).toEqual({
      ticket: "PROJ-456",
      statusAtTrigger: "Ready for Autopilot",
    });
  });

  test("(c) repository_dispatch missing ticket → throws MISSING_REQUIRED_DISPATCH_FIELD: ticket", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { status_at_trigger: "Ready for Autopilot" },
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });

  test("(d) repository_dispatch missing status_at_trigger → throws MISSING_REQUIRED_DISPATCH_FIELD: status_at_trigger", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { ticket: "PROJ-456" },
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: status_at_trigger");
  });

  test("workflow_call missing ticket → throws MISSING_REQUIRED_DISPATCH_FIELD: ticket", () => {
    const payload: GithubEventPayload = {
      eventName: "workflow_call",
      inputs: {},
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });

  test("empty-string ticket counts as missing (defence in depth)", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { ticket: "", status_at_trigger: "Ready" },
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });

  test("unknown eventName throws (no silent fallback)", () => {
    const payload = { eventName: "push" } as unknown as GithubEventPayload;
    expect(() => readDispatch(payload)).toThrow();
  });
});

describe("MissingDispatchFieldError class", () => {
  test("is distinguishable for catch-and-translate", () => {
    const err = new MissingDispatchFieldError("ticket");
    expect(err).toBeInstanceOf(MissingDispatchFieldError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MissingDispatchFieldError");
    expect(err.fieldName).toBe("ticket");
    expect(err.message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });
});
