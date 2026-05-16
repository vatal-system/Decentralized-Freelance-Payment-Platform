import { ErrorRequestHandler } from "express";

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof AppError ? err.statusCode : 500;
  const message = status < 500 ? err.message : "Internal server error";
  res.status(status).json({ error: message });
};
