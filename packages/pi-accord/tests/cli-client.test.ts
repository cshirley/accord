import { afterEach, describe, expect, test } from "bun:test";
import { resolvePiCliDelegateMode } from "../src/adapters/pi/cli-client.js";

describe("pi cli-client", () => {
  const previous = process.env.ACCORD_CLI_DELEGATE;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.ACCORD_CLI_DELEGATE;
    } else {
      process.env.ACCORD_CLI_DELEGATE = previous;
    }
  });

  test("defaults to in-process", () => {
    delete process.env.ACCORD_CLI_DELEGATE;
    expect(resolvePiCliDelegateMode()).toBe("in-process");
  });

  test("subprocess when ACCORD_CLI_DELEGATE=subprocess", () => {
    process.env.ACCORD_CLI_DELEGATE = "subprocess";
    expect(resolvePiCliDelegateMode()).toBe("subprocess");
  });
});
