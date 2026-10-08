import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HORIZON_URL: z.string().url(),
  SOROBAN_RPC_URL: z.string().url(),
  ESCROW_CONTRACT_ID: z.string().default(""),
  DISPUTE_CONTRACT_ID: z.string().default(""),
  REPUTATION_CONTRACT_ID: z.string().default(""),
  USDC_CONTRACT_ID: z.string().default(""),
  XLM_CONTRACT_ID: z.string().default(""),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  // Comma-separated Stellar addresses that may resolve disputes through the
  // API. Empty means "nobody", not "everybody": the route fails closed.
  ARBITRATOR_ADDRESSES: z.string().default(""),
  // Comma-separated browser origins allowed to call the API (e.g. the Vercel
  // frontend). Empty means "no restriction" in development, but production
  // warns loudly because that allows every origin.
  CORS_ORIGIN: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
