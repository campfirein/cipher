# E2E Tests

End-to-end tests that run against real backend services. These tests verify full request/response flows — no mocks, no stubs.

## Prerequisites

- Node.js (same version as the rest of the project)
- A running backend service (or access to a staging environment)
- Required environment variables configured (see below)

## Environment Variables

E2E tests use the same variable names as the runtime (see `.env.example`). All are required — there are no hardcoded defaults.

| Variable | Required | Notes |
|---|---|---|
| `BRV_E2E_API_KEY` | Yes | Auth gate — tests skip if unset |
| `BRV_IAM_BASE_URL` | Yes | Root domain only (no path) |
| `BRV_COGIT_BASE_URL` | Yes | Root domain only (no path) |
| `BRV_LLM_BASE_URL` | Yes | Root domain only |
| `BRV_GIT_REMOTE_BASE_URL` | Yes | May include path |
| `BRV_WEB_APP_URL` | Yes | May include path |

Copy `.env.example` to `.env.development` and fill in your environment's values. The E2E mocha config loads dotenv automatically.

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run a specific E2E test file
npx mocha --config test/e2e/.mocharc.e2e.json "test/e2e/path/to/file.test.ts"
```

## Behavior

- **Timeout**: 120 seconds per test (vs 60s for unit tests) — backend calls need more time
- **Serial execution**: Tests run one at a time (`bail: true`) — if authentication fails, subsequent tests are skipped rather than producing misleading failures
- **Exit**: Mocha force-exits after tests complete to avoid hanging on open handles

## Adding New Tests

1. Create a `*.test.ts` file anywhere under `test/e2e/`
2. The file will be automatically picked up by the `test/e2e/**/*.test.ts` glob
3. E2E tests are excluded from `npm test` — they only run via `npm run test:e2e`

Keep tests independent where possible. If tests must run in a specific order, place them in a single file with ordered `describe`/`it` blocks rather than relying on file execution order.
