/**
 * auth.ts
 *
 * JWT middleware. Tokens are issued by POST /api/users/auth after the client
 * signs a challenge with their Stellar private key (Freighter).
 *
 * The JWT payload carries { sub: stellarAddress }.
 */

import { RequestHandler } from "express";
import { jwtVerify } from "jose";
import { config } from "../config";
import { AppError } from "./errorHandler";

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface AuthLocals {
  stellarAddress: string;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError(401, "Missing authorization header"));
  }
  try {
    const token = header.slice(7);
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== "string") throw new Error();
    res.locals.stellarAddress = payload.sub;
    next();
  } catch {
    next(new AppError(401, "Invalid or expired token"));
  }
};
