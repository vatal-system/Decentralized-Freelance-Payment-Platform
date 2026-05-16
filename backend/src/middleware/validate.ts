import { RequestHandler } from "express";
import { ZodSchema } from "zod";
import { AppError } from "./errorHandler";

/** Validates req.body against a Zod schema; attaches parsed value back to req.body. */
export function validate(schema: ZodSchema): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError(400, result.error.issues.map((i) => i.message).join(", ")));
    }
    req.body = result.data;
    next();
  };
}
