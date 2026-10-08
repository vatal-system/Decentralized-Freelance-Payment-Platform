import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { config } from "./config";
import { isAllowedOrigin, parseList } from "./lib/access";
import { errorHandler } from "./middleware/errorHandler";
import { usersRouter } from "./routes/users";
import { jobsRouter } from "./routes/jobs";
import { escrowRouter } from "./routes/escrow";
import { disputesRouter } from "./routes/disputes";
import { reputationRouter } from "./routes/reputation";

export function createApp() {
  const app = express();

  app.use(helmet());

  // CORS_ORIGIN is a comma-separated allowlist of browser origins. When it is
  // unset we keep the permissive development behaviour, but saying so out loud
  // in production beats silently exposing the API to every origin.
  const allowedOrigins = parseList(config.CORS_ORIGIN);
  if (allowedOrigins.length === 0 && config.NODE_ENV === "production") {
    console.warn(
      "[cors] CORS_ORIGIN is unset in production — every origin may call this API. " +
        "Set it to your frontend origin, e.g. CORS_ORIGIN=https://your-app.vercel.app",
    );
  }
  app.use(
    cors({
      origin: (origin, callback) =>
        isAllowedOrigin(origin ?? undefined, allowedOrigins)
          ? callback(null, true)
          : callback(null, false),
    }),
  );

  app.use(express.json());
  app.use(rateLimit({ windowMs: 60_000, max: 100 }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/users", usersRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/escrow", escrowRouter);
  app.use("/api/disputes", disputesRouter);
  app.use("/api/reputation", reputationRouter);

  app.use(errorHandler);

  return app;
}
