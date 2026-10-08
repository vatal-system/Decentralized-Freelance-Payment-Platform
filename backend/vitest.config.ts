import { defineConfig } from "vitest/config";

// Unit tests import modules that read `config` (which validates env vars at
// import time), so provide safe defaults for the test run. No network or DB is
// touched by the tests.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
      JWT_SECRET: "test_secret_that_is_at_least_32_chars_long!",
      HORIZON_URL: "https://horizon-testnet.stellar.org",
      SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
    },
  },
});
