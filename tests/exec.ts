import { mondisTest, oid } from './setup';

describe('Exec CachedQueries', () => {
  mondisTest('config:{} exec:{}', async (ctx) => {
    await ctx.execAll({});
    await ctx.expectRedisSnapshot('Q:*');
  });

  mondisTest('config:{} exec:{ skip: 5 }', async (ctx) => {
    await ctx.execAll({ skip: 5 });
  });

  mondisTest('config:{} exec:{ limit: 3 }', async (ctx) => {
    await ctx.execAll({ limit: 3 });
  });

  mondisTest('config:{} exec:{ skip: 5, limit: 3 }', async (ctx) => {
    await ctx.execAll({ skip: 5, limit: 3 });
  });

  mondisTest('config:{ cacheCount: 3 } exec:{}', async (ctx) => {
    await ctx.execAll({});
    await ctx.expectRedisSnapshot('Q:*');
  }, { cacheCount: 3 });

  mondisTest('config:{ cacheCount: 3 } exec:{ skip: 5 }', async (ctx) => {
    await ctx.execAll({ skip: 5 });
  }, { cacheCount: 3 });

  mondisTest('config:{ cacheCount: 3 } exec:{ limit: 3 }', async (ctx) => {
    await ctx.execAll({ limit: 3 });
    await new Promise((res) => {
      setTimeout(res, 500);
    });
    await ctx.expectRedisSnapshot('Q:*');
  }, { cacheCount: 3 });

  mondisTest('config:{ cacheCount: 3 } exec:{ skip: 5, limit: 3 }', async (ctx) => {
    await ctx.execAll({ skip: 5, limit: 3 });
  }, { cacheCount: 3 });

  mondisTest('Exec all twice, config:{}', async (ctx) => {
    await ctx.execAll({});
    await ctx.execAll({});
  });

  mondisTest('Exec all twice, config:{ cacheCount: 3 }', async (ctx) => {
    await ctx.execAll({});
    await ctx.execAll({});
  }, { cacheCount: 3 });

  mondisTest('Only count queries', async (ctx) => {
    const { queries: q } = ctx.mondis;
    await Promise.all([
      q.Static1.count(),
      q.Static2.count(),
      q.Dynamic1.count({ params: ['truck'] }),
      q.Dynamic2.count({ params: ['A'] }),
      q.Dynamic3.count({ params: [oid('D2')] }),
      q.Complex1.count({ params: [['car', 'bus']] }),
      q.Complex2.count({ params: [5000] }),
      q.Unique1.count([oid('A4')]),
      q.Populated1.count(),
      q.Populated2.count(),
      q.Sorted1.count(),
      q.Targeted1.count({ params: [[oid('B1'), oid('B2')]] }),
    ]);
    await ctx.expectRedisSnapshot('Q:*');
  });

  mondisTest('Exec filtered query', async ({ mondis }) => {
    const { Static2, Dynamic1 } = mondis.queries;
    await Static2.execWithCount({ filter: (doc) => (doc.price > 2500) });
    await Dynamic1.count({
      params: ['car'],
      filter: (doc) => (doc.price > 2500),
    });
  });

  mondisTest('Calculate hash value', ({ mondis, hashMocks }) => {
    const { Static1, Dynamic1 } = mondis.queries;
    hashMocks.forEach((spy) => spy.mockRestore());
    expect(Static1.hash).toBeTruthy();
    expect(Dynamic1.hash).toBeTruthy();
  });
});
