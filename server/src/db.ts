import { PrismaClient } from "@prisma/client";

type PrismaGlobal = typeof globalThis & { __autoDmPrisma?: PrismaClient };
const prismaGlobal = globalThis as PrismaGlobal;

/**
 * Reuses the Prisma client across warm serverless invocations. DATABASE_URL must
 * point to the Supabase Supavisor transaction pooler in Vercel deployments.
 */
export const prisma = prismaGlobal.__autoDmPrisma ?? new PrismaClient();
prismaGlobal.__autoDmPrisma = prisma;
