import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Prisma client so we can assert exactly what where/data the tenant
// facade passes down — this is the security-critical guarantee.
// `vi.hoisted` lets the mock object exist before the hoisted vi.mock factory.
const prismaMock = vi.hoisted(() => ({
  search: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  shop: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  keywordSnapshot: { create: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { tenantDb } from '@/lib/db/tenant';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tenantDb — write scoping', () => {
  it('stamps userId on created searches (never trusts caller input)', async () => {
    prismaMock.search.create.mockResolvedValue({ id: 's1' });
    await tenantDb('user-A').searches.create({ seedKeyword: 'linen apron' });

    expect(prismaMock.search.create).toHaveBeenCalledWith({
      data: { userId: 'user-A', seedKeyword: 'linen apron' },
    });
  });

  it('stamps userId on created shops', async () => {
    prismaMock.shop.create.mockResolvedValue({ id: 'shop1' });
    await tenantDb('user-A').shops.create({ name: 'My Shop' });

    expect(prismaMock.shop.create).toHaveBeenCalledWith({
      data: { userId: 'user-A', name: 'My Shop', etsyShopId: null },
    });
  });
});

describe('tenantDb — read scoping', () => {
  it('filters list() by the tenant userId', async () => {
    prismaMock.search.findMany.mockResolvedValue([]);
    await tenantDb('user-A').searches.list({ take: 10 });

    expect(prismaMock.search.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-A' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });

  it('getById cannot read another tenant row (userId is always in the where)', async () => {
    prismaMock.search.findFirst.mockResolvedValue(null);
    const result = await tenantDb('user-A').searches.getById('some-id');

    expect(prismaMock.search.findFirst).toHaveBeenCalledWith({
      where: { id: 'some-id', userId: 'user-A' },
    });
    expect(result).toBeNull();
  });

  it('two tenants produce distinct userId filters', async () => {
    prismaMock.search.findMany.mockResolvedValue([]);
    await tenantDb('user-A').searches.list();
    await tenantDb('user-B').searches.list();

    expect(prismaMock.search.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { userId: 'user-A' },
    }));
    expect(prismaMock.search.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { userId: 'user-B' },
    }));
  });
});

describe('tenantDb — snapshot history (Phase 2 step 6)', () => {
  it('creates a search with nested snapshots + scores, stamped with userId', async () => {
    prismaMock.search.create.mockResolvedValue({ id: 's1', snapshots: [] });

    await tenantDb('user-A').searches.createWithSnapshots({
      seedKeyword: 'linen apron',
      snapshots: [
        {
          keyword: 'linen apron',
          competitionCount: 4213,
          avgFavorites: 120.5,
          priceMin: 10,
          priceMed: 22,
          priceMax: 40,
          difficulty: 60.1,
          demand: 70.2,
          opportunity: 28,
          verdict: 'CROWDED',
        },
      ],
    });

    const arg = prismaMock.search.create.mock.calls[0][0];
    expect(arg.data.userId).toBe('user-A');
    expect(arg.data.seedKeyword).toBe('linen apron');

    const snap = arg.data.snapshots.create[0];
    expect(snap).toMatchObject({
      keyword: 'linen apron',
      competitionCount: 4213,
      avgFavorites: 120.5,
      priceMin: 10,
      priceMed: 22,
      priceMax: 40,
    });
    // Score is nested 1:1 under the snapshot.
    expect(snap.score.create).toEqual({
      difficulty: 60.1,
      demand: 70.2,
      opportunity: 28,
      verdict: 'CROWDED',
    });
  });

  it('reads a keyword series only through searches the user owns', async () => {
    prismaMock.keywordSnapshot.findMany.mockResolvedValue([]);
    await tenantDb('user-A').trends.forKeyword('linen apron');

    expect(prismaMock.keywordSnapshot.findMany).toHaveBeenCalledWith({
      where: { keyword: 'linen apron', search: { userId: 'user-A' } },
      orderBy: { capturedAt: 'asc' },
      include: { score: true },
      take: undefined,
    });
  });

  it('lists tracked keywords scoped to the user, most-tracked first', async () => {
    prismaMock.keywordSnapshot.groupBy.mockResolvedValue([
      { keyword: 'rare', _count: { _all: 1 }, _max: { capturedAt: new Date('2026-01-02') } },
      { keyword: 'common', _count: { _all: 5 }, _max: { capturedAt: new Date('2026-01-01') } },
    ]);

    const result = await tenantDb('user-A').trends.keywords();

    expect(prismaMock.keywordSnapshot.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { search: { userId: 'user-A' } } }),
    );
    expect(result.map((r) => r.keyword)).toEqual(['common', 'rare']);
    expect(result[0].captureCount).toBe(5);
  });
});

describe('tenantDb — snapshot ownership', () => {
  it('refuses to attach a snapshot to a search the user does not own', async () => {
    prismaMock.search.findFirst.mockResolvedValue(null); // not owned
    await expect(
      tenantDb('user-A').saveSnapshot(
        'foreign-search',
        {
          keyword: 'x',
          competitionCount: 1,
          avgFavorites: 0,
        } as never,
        { difficulty: 0, demand: 0, opportunity: 0, verdict: 'AVOID' } as never,
      ),
    ).rejects.toThrow(/not found for this user/i);
    expect(prismaMock.keywordSnapshot.create).not.toHaveBeenCalled();
  });

  it('requires a non-empty userId', () => {
    expect(() => tenantDb('')).toThrow(/requires a userId/i);
  });
});
