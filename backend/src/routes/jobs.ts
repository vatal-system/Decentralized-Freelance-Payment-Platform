/**
 * jobs.ts
 *
 * GET  /api/jobs          — list jobs (filterable by status, client, freelancer)
 * POST /api/jobs          — create a job (off-chain record; escrow funded separately)
 * GET  /api/jobs/:id      — get single job with milestones
 * PUT  /api/jobs/:id/assign — client assigns a freelancer
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";

export const jobsRouter = Router();

const milestoneSchema = z.object({
  description: z.string().optional(),
  amountUsdc: z.number().positive(),
  deadline: z.string().datetime().optional(),
});

const createJobSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10),
  milestones: z.array(milestoneSchema).min(1),
  expiresAt: z.string().datetime().optional(),
});

// GET /api/jobs
jobsRouter.get("/", async (req, res, next) => {
  try {
    const { status, client, freelancer, page = "1", limit = "20" } = req.query;
    const jobs = await prisma.job.findMany({
      where: {
        ...(status ? { status: String(status) as any } : {}),
        ...(client ? { client: { stellarAddress: String(client) } } : {}),
        ...(freelancer ? { freelancer: { stellarAddress: String(freelancer) } } : {}),
      },
      include: { milestones: true, client: true, freelancer: true },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs
jobsRouter.post("/", requireAuth, validate(createJobSchema), async (req, res, next) => {
  try {
    const { title, description, milestones, expiresAt } = req.body as z.infer<typeof createJobSchema>;

    const client = await prisma.user.findUnique({
      where: { stellarAddress: res.locals.stellarAddress },
    });
    if (!client) throw new AppError(404, "User not found — call /api/users/auth first");

    const totalAmountUsdc = milestones.reduce((sum, m) => sum + m.amountUsdc, 0);

    const job = await prisma.job.create({
      data: {
        title,
        description,
        totalAmountUsdc,
        clientId: client.id,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        milestones: {
          create: milestones.map((m, i) => ({
            index: i,
            amountUsdc: m.amountUsdc,
            description: m.description,
            deadline: m.deadline ? new Date(m.deadline) : undefined,
          })),
        },
      },
      include: { milestones: true },
    });

    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:id
jobsRouter.get("/:id", async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { milestones: true, client: true, freelancer: true, disputes: true, ratings: true },
    });
    if (!job) throw new AppError(404, "Job not found");
    res.json(job);
  } catch (err) {
    next(err);
  }
});

// PUT /api/jobs/:id/assign
jobsRouter.put("/:id/assign", requireAuth, async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { client: true } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.client.stellarAddress !== res.locals.stellarAddress) {
      throw new AppError(403, "Only the client can assign a freelancer");
    }

    const { freelancerAddress } = req.body as { freelancerAddress: string };
    const freelancer = await prisma.user.findUnique({ where: { stellarAddress: freelancerAddress } });
    if (!freelancer) throw new AppError(404, "Freelancer not found");

    const updated = await prisma.job.update({
      where: { id: req.params.id },
      data: { freelancerId: freelancer.id },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
