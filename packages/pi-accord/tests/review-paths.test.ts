import { describe, expect, test } from "bun:test";
import {
  isSecuritySensitivePath,
  isTestFilePath,
  nextPhaseAfterPhaseCode,
  pathsIncludeSecuritySensitive,
  phaseCodeMustRespawnPhaseTest,
} from "../src/core/orchestration/review-paths.js";

describe("review-paths", () => {
  test("isTestFilePath matches common test paths", () => {
    expect(isTestFilePath("src/foo.test.ts")).toBe(true);
    expect(isTestFilePath("src/__tests__/bar.ts")).toBe(true);
    expect(isTestFilePath("src/foo.ts")).toBe(false);
  });

  test("isSecuritySensitivePath matches broad security surfaces", () => {
    expect(isSecuritySensitivePath("src/middleware/auth.ts")).toBe(true);
    expect(isSecuritySensitivePath(".github/workflows/ci.yml")).toBe(true);
    expect(isSecuritySensitivePath("package.json")).toBe(true);
    expect(isSecuritySensitivePath("src/utils/format.ts")).toBe(false);
  });

  test("nextPhaseAfterPhaseCode respawns phase-test when tests changed (RGR violation)", () => {
    expect(nextPhaseAfterPhaseCode(["src/a.ts"])).toBe("review-code");
    expect(nextPhaseAfterPhaseCode(["src/a.test.ts"])).toBe("phase-test");
    expect(nextPhaseAfterPhaseCode(["src/auth/login.ts"])).toBe("review-security");
    expect(
      nextPhaseAfterPhaseCode(["src/auth/login.ts", "src/login.test.ts"]),
    ).toBe("phase-test");
    expect(nextPhaseAfterPhaseCode([], { testIssuesEmitted: 1 })).toBe("phase-test");
  });

  test("phaseCodeMustRespawnPhaseTest honours test_issues_emitted and test paths", () => {
    expect(phaseCodeMustRespawnPhaseTest([], { testIssuesEmitted: 1 })).toBe(true);
    expect(phaseCodeMustRespawnPhaseTest(["src/a.test.ts"])).toBe(true);
    expect(phaseCodeMustRespawnPhaseTest(["src/a.ts"])).toBe(false);
  });

  test("pathsIncludeSecuritySensitive", () => {
    expect(pathsIncludeSecuritySensitive(["src/jwt.ts"])).toBe(true);
    expect(pathsIncludeSecuritySensitive(["src/helpers.ts"])).toBe(false);
  });
});
