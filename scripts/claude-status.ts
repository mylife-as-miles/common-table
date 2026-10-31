import {
  readClaudeConfig,
  ClaudeConfigError,
  CLAUDE_TEST_BUDGET_USD,
  CLAUDE_ATTEMPT_RESERVATION_USD,
} from "../server/claude-config.ts";

try {
  const config = readClaudeConfig();
  console.log(
    JSON.stringify(
      {
        mode: config.mode,
        model: config.model,
        keyConfigured: Boolean(config.apiKey),
        expectedOrganization: config.expectedOrgName,
        generationCallsMade: 0,
        approvedTestBudgetUsd: CLAUDE_TEST_BUDGET_USD,
        reservedPerAttemptUsd: CLAUDE_ATTEMPT_RESERVATION_USD,
        note: "Configuration presence only; API access and billing have not been tested.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "blocked",
      code:
        error instanceof ClaudeConfigError ? error.code : "configuration_error",
    }),
  );
  process.exitCode = 1;
}
