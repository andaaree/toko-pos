/**
 * Backend smoke-test Jest config.
 *
 * Separate from the frontend `jest` config (test:frontend) because these tests
 * run in the node environment and talk to the real Supabase project — they are
 * integration smoke tests, not unit tests. Kept in its own config so
 * `npm run test:frontend` and `npm run test:backend` never collect each other's
 * files.
 */
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'backend',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/backend'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'es2020', esModuleInterop: true } }],
  },
  setupFiles: ['<rootDir>/tests/backend/loadEnv.ts'],
  testTimeout: 30000,
  // Smoke tests share one database; running files in parallel would interleave
  // stock mutations across suites.
  maxWorkers: 1,
  verbose: true,
}
