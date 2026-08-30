/**
 * Shared path classifiers for review agent routing (harness + lifecycle).
 */

const TEST_FILE_PATTERN =
  /\.test\.|\.spec\.|_test\.(go|rs)|test_.*\.py|_spec\.rb|Test\.java|Tests\.cs/i;

const TEST_DIR_PATTERN = /\/(test|__tests__|tests|spec)\//;

/** Security-sensitive path segments for mandatory `review-security` routing. */
const SECURITY_FILE_PATTERN =
  /(?:^|\/)(auth|authentication|authorization|session|sessions|oauth|jwt|middleware|payment|payments|billing|crypto|cryptography|secret|secrets|credential|credentials|password|token|tokens|cors|csrf|iam|policy|policies|acl|rbac|guard|guards|encrypt|decrypt|signing|verify|webhook)(?:\/|$|\.)/i;

const SECURITY_FILE_SUFFIX_PATTERN = /\.(env(\.|$)|pem|key|p12|pfx|crt|cer|kubeconfig)$/i;

const SECURITY_INFRA_PATTERN =
  /(?:^|\/)(api|public[.-]?api|graphql|grpc|openapi|swagger|terraform|\.github\/workflows|docker-compose)(?:\/|$|\.)/i;

const SECURITY_MANIFEST_PATTERN =
  /(?:^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|Gemfile\.lock|requirements\.txt|Pipfile\.lock)(?:$|\/)/i;

export function isTestFilePath(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath) || TEST_DIR_PATTERN.test(filePath);
}

export function pathsIncludeTestFiles(paths: ReadonlyArray<string>): boolean {
  return paths.some(isTestFilePath);
}

export function isSecuritySensitivePath(filePath: string): boolean {
  return (
    SECURITY_FILE_PATTERN.test(filePath) ||
    SECURITY_FILE_SUFFIX_PATTERN.test(filePath) ||
    SECURITY_INFRA_PATTERN.test(filePath) ||
    SECURITY_MANIFEST_PATTERN.test(filePath)
  );
}

export function pathsIncludeSecuritySensitive(paths: ReadonlyArray<string>): boolean {
  return paths.some(isSecuritySensitivePath);
}

/**
 * Next harness phase after **phase-code** completes.
 *
 * RGR: `phase-code` must not touch tests. Test files in `files_changed` or
 * `test_issues_emitted` route back to **phase-test** (and reset pre-impl gates).
 */
export function nextPhaseAfterPhaseCode(
  filesChanged: ReadonlyArray<string>,
  options?: { testIssuesEmitted?: number },
): "phase-test" | "review-security" | "review-code" {
  if (options?.testIssuesEmitted && options.testIssuesEmitted > 0) {
    return "phase-test";
  }
  if (pathsIncludeTestFiles(filesChanged)) {
    return "phase-test";
  }
  if (pathsIncludeSecuritySensitive(filesChanged)) {
    return "review-security";
  }
  return "review-code";
}

/** True when phase-code violated the test/code separation boundary. */
export function phaseCodeMustRespawnPhaseTest(
  filesChanged: ReadonlyArray<string>,
  options?: { testIssuesEmitted?: number },
): boolean {
  return (
    Boolean(options?.testIssuesEmitted && options.testIssuesEmitted > 0) ||
    pathsIncludeTestFiles(filesChanged)
  );
}
