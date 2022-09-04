import type Mondis from '../mondis';
import type CachedQuery from './index';
import type {
  CacheEffect,
  HasObjectId,
} from './types';

type InsertInvalidation =
  | { key: string }
  | { set: string }
  | null;

function union<T>(a: T[] | Set<T>, b: T[] | Set<T>) {
  const result = new Set<T>();
  a.forEach((val) => result.add(val));
  b.forEach((val) => result.add(val));
  return Array.from(result);
}

function okForComparison(val: unknown) {
  const t = (typeof val);
  return (val === null || t !== 'object') && t !== 'function';
}

/**
 * Returns the cache keys that need to be invalidated when an insert effect occurs.
 */
function getInsertInvalidation(
  cq: CachedQuery<unknown, unknown[]>,
  modelName: string,
  doc: HasObjectId,
): InsertInvalidation {
  const { unique, invalidateOnInsert, model } = cq.config;
  // If this query uniquely identifies a single document,
  // then a new document will have no effect on cached queries.
  if (unique || !invalidateOnInsert || model !== modelName) return null;

  const { staticKeys, dynamicKeys, complexQuery } = cq.classification;
  // Currently only supports simple equality checks (TODO: expand supported operations?)
  // If the key doesn't match the query, no need to invalidate
  const someMismatchExists = Object.entries(staticKeys).some(([key, val]) => (
    okForComparison(val)
    && okForComparison(doc[key])
    && val !== doc[key]
  ));
  // If any field in the document contradicts the query, no need to invalidate
  if (someMismatchExists) return null;
  if (complexQuery) {
    // If any configurable part of the query is not just an equality check,
    // we have to invalidate all queries, because we don't know if it has changed.
    return { set: cq.getCacheKeyForAll() };
  }
  // Otherwise, just reconstruct the cache key to only invalidate queries with matching params
  const params = dynamicKeys.map((key) => doc[key]);
  return { key: cq.getCacheKey(params) };
}

function parseParamsFromQueryKey(key: string) {
  const result = key.match(/^q:[^[]+(.+?)$/);
  try {
    const match = result && result[1];
    if (match) return JSON.parse(match) as unknown[];
  } catch (err) {
    // logger.warn({ err, tag: 'CACHE_INVALIDATION_ERROR' }, 'Failed to parse JSON');
  }
  return [];
}

export default class InvalidationHandler {
  context: Mondis;

  constructor(context: Mondis) {
    this.context = context;
  }

  // TODO: add queueing mechanism for optimized batching
  onCacheEffect(effect: CacheEffect) {
    if (effect.op === 'insert') this.doInsertInvalidation(effect);
    if (effect.op === 'remove') this.doRemoveInvalidation(effect);
  }

  async doInsertInvalidation(effect: CacheEffect & { op: 'insert' }) {
    const { redis } = this.context;
    const { modelName, docs } = effect;

    const { keys, sets } = this.collectInsertInvalidations(modelName, docs);
    const expandedSets = sets.size ? await redis.sunion(...sets) : [];
    const invalidatedKeys = await this.invalidate(union(keys, expandedSets));
  }

  async doRemoveInvalidation(effect: CacheEffect & { op: 'remove' }) {
    const { redis } = this.context;
    const { ids } = effect;
    // TODO: handle in bulk
    const dependentKeys = await redis.smembers(`obj:${String(ids[0])}`);
    const invalidatedKeys = await this.invalidate(dependentKeys);
  }

  async invalidate(keys: string[]): Promise<string[]> {
    if (!keys.length) return [];

    const { redis } = this.context;
    const multi = redis.multi();
    keys.forEach((key) => multi.delquery(key));
    const results = await multi.exec();
    if (!results || !results.length) return [];

    const invalidatedKeys: string[] = [];
    results.forEach((didExist, index) => {
      const key = keys[index];
      if (didExist && key) invalidatedKeys.push(key);
    });

    return invalidatedKeys;
  }

  async rehydrate(keys: string[]) {
    if (!keys.length) return;

    const promises = keys.map(async (key) => {
      const query = this.findCachedQueryByKey(key);
      if (!query || !query.config.rehydrate) return;

      const params = parseParamsFromQueryKey(key);
      await query.exec({ params, limit: query.config.cacheCount, skipCache: true });
    });

    await Promise.all(promises);
  }

  collectInsertInvalidations(model: string, docs: HasObjectId[]) {
    const keys = new Set<string>();
    const sets = new Set<string>();
    const { allCachedQueries } = this;
    allCachedQueries.forEach((query) => {
      docs.forEach((doc) => {
        const info = getInsertInvalidation(query, model, doc);
        if (!info) return;
        if ('key' in info) keys.add(info.key);
        if ('set' in info) sets.add(info.set);
      });
    });
    return { keys, sets };
  }

  findCachedQueryByKey(key: string) {
    const { allCachedQueries } = this;
    const match = key.match(/^q:(.*?)\[/);
    if (match && match[1]) {
      const found = allCachedQueries.find((cq) => cq.hash === match[1]);
      if (found) return found;
    }
    return null;
  }

  get allCachedQueries(): CachedQuery<unknown, unknown[]>[] {
    // TODO: implement
    return [];
  }
}
