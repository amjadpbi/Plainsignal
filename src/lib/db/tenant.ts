import 'server-only';
import type { NicheVerdict, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/** One keyword's captured market signals + derived scores, ready to persist. */
export interface SnapshotInput {
  keyword: string;
  competitionCount: number;
  avgFavorites: number;
  priceMin: number | null;
  priceMed: number | null;
  priceMax: number | null;
  difficulty: number;
  demand: number;
  opportunity: number;
  verdict: NicheVerdict;
}

/** Map an analyzed keyword into the nested Prisma create shape. */
function toSnapshotCreate(s: SnapshotInput) {
  return {
    keyword: s.keyword,
    competitionCount: s.competitionCount,
    avgFavorites: s.avgFavorites,
    priceMin: s.priceMin,
    priceMed: s.priceMed,
    priceMax: s.priceMax,
    score: {
      create: {
        difficulty: s.difficulty,
        demand: s.demand,
        opportunity: s.opportunity,
        verdict: s.verdict,
      },
    },
  };
}

/**
 * CENTRALIZED TENANT ISOLATION (CLAUDE.md §5, step 5).
 *
 * Every user-owned table must be filtered by user_id in application code — one
 * missed filter is a cross-tenant data leak. Rather than repeating
 * `where: { userId }` on every route (easy to forget), all access to user-owned
 * models goes through `tenantDb(userId)`. Each method here hard-codes the
 * userId filter on reads AND stamps it on writes, so a route physically cannot
 * query another tenant's rows through this facade.
 *
 * RULE: routes must use `tenantDb(...)` for Shop / Search / their children and
 * never import the raw `prisma` client for those models.
 */
export function tenantDb(userId: string) {
  if (!userId) throw new Error('tenantDb requires a userId.');

  return {
    userId,

    searches: {
      /** Save a research run for this user. */
      create(input: { seedKeyword: string }) {
        return prisma.search.create({
          data: { userId, seedKeyword: input.seedKeyword },
        });
      },
      /**
       * Save a research run AND its per-keyword snapshots in one transaction
       * (Prisma nested writes are atomic). This is what builds the time-series:
       * every run captures a new dated point for each keyword.
       */
      createWithSnapshots(input: { seedKeyword: string; snapshots: SnapshotInput[] }) {
        return prisma.search.create({
          data: {
            userId,
            seedKeyword: input.seedKeyword,
            snapshots: { create: input.snapshots.map(toSnapshotCreate) },
          },
          include: { snapshots: { include: { score: true } } },
        });
      },
      /** List this user's searches, newest first. */
      list(args?: { take?: number }) {
        return prisma.search.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: args?.take,
        });
      },
      /** Fetch one search by id, scoped to this user (null if not theirs). */
      getById(id: string) {
        return prisma.search.findFirst({ where: { id, userId } });
      },
      count() {
        return prisma.search.count({ where: { userId } });
      },
    },

    /** Saved fee & profit calculations (tenant-owned). */
    feeCalculations: {
      create(input: {
        label?: string | null;
        itemCost: number;
        shippingCost: number;
        salePrice: number;
        shippingCharged: number;
        revenue: number;
        totalFees: number;
        netProfit: number;
        marginPct: number;
        breakdownJson: Prisma.InputJsonValue;
      }) {
        return prisma.feeCalculation.create({
          data: { ...input, label: input.label ?? null, userId },
        });
      },
      list(args?: { take?: number }) {
        return prisma.feeCalculation.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: args?.take,
        });
      },
      getById(id: string) {
        return prisma.feeCalculation.findFirst({ where: { id, userId } });
      },
      /** Delete one, scoped — deleteMany so a foreign id simply affects 0 rows. */
      async delete(id: string) {
        const { count } = await prisma.feeCalculation.deleteMany({ where: { id, userId } });
        return count > 0;
      },
    },

    shops: {
      create(input: { name: string; etsyShopId?: string | null }) {
        return prisma.shop.create({
          data: { userId, name: input.name, etsyShopId: input.etsyShopId ?? null },
        });
      },
      list() {
        return prisma.shop.findMany({ where: { userId }, orderBy: { name: 'asc' } });
      },
      getById(id: string) {
        return prisma.shop.findFirst({ where: { id, userId } });
      },
    },

    /**
     * Keyword history (Phase 2, step 6). Snapshots are reached only through a
     * Search the user owns (`search: { userId }`), so one tenant can never read
     * another's capture history.
     */
    trends: {
      /** Keywords this user has history for, with capture counts. */
      async keywords() {
        const rows = await prisma.keywordSnapshot.groupBy({
          by: ['keyword'],
          where: { search: { userId } },
          _count: { _all: true },
          _max: { capturedAt: true },
        });
        return rows
          .map((r) => ({
            keyword: r.keyword,
            captureCount: r._count._all,
            lastCapturedAt: r._max.capturedAt,
          }))
          .sort((a, b) => {
            // Most-tracked first, then most recent.
            if (b.captureCount !== a.captureCount) return b.captureCount - a.captureCount;
            return (b.lastCapturedAt?.getTime() ?? 0) - (a.lastCapturedAt?.getTime() ?? 0);
          });
      },

      /** Full time-series for one keyword, oldest first (chronological). */
      forKeyword(keyword: string, args?: { take?: number }) {
        return prisma.keywordSnapshot.findMany({
          where: { keyword, search: { userId } },
          orderBy: { capturedAt: 'asc' },
          include: { score: true },
          take: args?.take,
        });
      },
    },

    /**
     * Persist a captured keyword snapshot + its score under a Search this user
     * owns. Ownership of the search is re-verified here so a snapshot can never
     * be attached to another tenant's search.
     */
    async saveSnapshot(
      searchId: string,
      snapshot: Prisma.KeywordSnapshotCreateWithoutSearchInput,
      score: Prisma.KeywordScoreCreateWithoutSnapshotInput,
    ) {
      const owned = await prisma.search.findFirst({
        where: { id: searchId, userId },
        select: { id: true },
      });
      if (!owned) throw new Error('Search not found for this user.');
      return prisma.keywordSnapshot.create({
        data: { ...snapshot, search: { connect: { id: searchId } }, score: { create: score } },
      });
    },
  };
}

export type TenantDb = ReturnType<typeof tenantDb>;
