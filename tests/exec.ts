import { mondisTest, MondisTestInstance, oid } from './setup';

async function execAll(
  mondis: MondisTestInstance,
  opts: { skip?: number, limit?: number, skipCache?: boolean },
) {
  const q = mondis.queries;
  await Promise.all([
    q.Static1.execWithCount({ ...opts }),
    q.Static2.execWithCount({ ...opts }),
    q.Dynamic1.execWithCount({ ...opts, params: ['truck'] }),
    q.Dynamic2.execWithCount({ ...opts, params: ['A'] }),
    q.Dynamic3.execWithCount({ ...opts, params: [oid('D2')] }),
    q.Complex1.execWithCount({ ...opts, params: [['car', 'bus']] }),
    q.Complex2.execWithCount({ ...opts, params: [5000] }),
    q.Unique1.execOne([oid('A4')]),
    q.Populated1.execWithCount({ ...opts }),
    q.Populated2.execWithCount({ ...opts }),
    q.Sorted1.execWithCount({ ...opts }),
    q.Targeted1.execWithCount({ ...opts, params: [[oid('B1'), oid('B2')]] }),
  ]);
}

describe('Exec CachedQueries', () => {
  mondisTest('config:{} exec:{}', async ({ mondis }) => {
    await execAll(mondis, {});
  });

  mondisTest('config:{} exec:{ skip: 5 }', async ({ mondis }) => {
    await execAll(mondis, { skip: 5 });
  });

  mondisTest('config:{} exec:{ limit: 3 }', async ({ mondis }) => {
    await execAll(mondis, { limit: 3 });
  });

  mondisTest('config:{} exec:{ skip: 5, limit: 3 }', async ({ mondis }) => {
    await execAll(mondis, { skip: 5, limit: 3 });
  });

  mondisTest('config:{ cacheCount: 3 } exec:{}', async ({ mondis }) => {
    await execAll(mondis, {});
  }, { cacheCount: 3 });

  mondisTest('config:{ cacheCount: 3 } exec:{ skip: 5 }', async ({ mondis }) => {
    await execAll(mondis, { skip: 5 });
  }, { cacheCount: 3 });

  mondisTest('config:{ cacheCount: 3 } exec:{ limit: 3 }', async ({ mondis }) => {
    await execAll(mondis, { limit: 3 });
  }, { cacheCount: 3 });

  mondisTest('config:{ cacheCount: 3 } exec:{ skip: 5, limit: 3 }', async ({ mondis }) => {
    await execAll(mondis, { skip: 5, limit: 3 });
  }, { cacheCount: 3 });

  mondisTest('Exec all twice', async ({ mondis }) => {
    await execAll(mondis, {});
    await execAll(mondis, {});
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
