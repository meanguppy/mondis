import type Mondis from '../mondis';
import type CachedQuery from './index';
import type {
  AnyObject,
  CacheEffect,
  QueryInfo,
} from './types';

type KeyInvalidation =
  | { hash: string, all: true }
  | { hash: string, keys: string[] };

function constructInvalidation(cq: CachedQuery, ...docs: AnyObject[]): KeyInvalidation {
  const { complexQuery, dynamicKeys } = cq.info.query;
  // If any configurable part of the query is not just an equality check,
  // we have to invalidate all queries, because we don't know if it has changed.
  if (complexQuery) return { hash: cq.hash, all: true };
  const keys = docs.map((doc) => {
    // TODO: use getValue to support dot-notation?
    // check with `classifyQuery`, can `dynamicKeys` be dot-notation?
    const params = dynamicKeys.map((key) => doc[key]);
    // Otherwise, just reconstruct the cache key to only invalidate queries with matching params
    return cq.getCacheKey(params);
  });
  return { hash: cq.hash, keys };
}

function wasProjectionModified(info: QueryInfo['select'], modifiedPaths: string[]) {
  if (!modifiedPaths.length) return false;
  const { inclusive, paths } = info;
  if (!paths.length) return true;
  if (inclusive) {
    // inclusive: return true if some prefix in paths was in modified.
    return modifiedPaths.some(
      (modified) => paths.find(
        (path) => modified === path
          || modified.startsWith(`${path}.`)
          || path.startsWith(`${modified}.`),
      ),
    );
  }
  // exclusive: return true if some prefix in modified was not found in paths.
  return !modifiedPaths.every(
    (modified) => paths.find(
      (path) => modified === path || modified.startsWith(`${path}.`),
    ),
  );
}

function getUpdateInvalidation(
  cq: CachedQuery,
  effect: CacheEffect & { op: 'update' },
  doc: { before: AnyObject, after: AnyObject },
): KeyInvalidation | null {
  const { model } = cq.config;
  const { modelName, modified } = effect;
  if (model !== modelName) return null;
  const { before, after } = doc;
  const { select, query: { matcher } } = cq.info;
  const wasMatch = matcher(before);
  const nowMatch = matcher(after);
  if (wasMatch && nowMatch) {
    if (wasProjectionModified(select, modified)) {
      return constructInvalidation(cq, before, after);
    }
  } else if (!wasMatch && nowMatch) {
    return constructInvalidation(cq, after);
  } else if (wasMatch && !nowMatch) {
    return constructInvalidation(cq, before);
  }
  return null;
}

/**
 * Returns the cache keys that need to be invalidated when an insert effect occurs.
 */
function getInsertInvalidation(
  cq: CachedQuery,
  effect: CacheEffect & { op: 'insert' },
  doc: AnyObject,
): KeyInvalidation | null {
  const { modelName } = effect;
  const { unique, invalidateOnInsert, model } = cq.config;
  // If this query uniquely identifies a single document,
  // then a new document will have no effect on cached queries.
  if (unique || !invalidateOnInsert || model !== modelName) return null;
  const { matcher } = cq.info.query;
  // If any field in the document contradicts the query, no need to invalidate
  const docCouldMatchQuery = matcher(doc);
  if (!docCouldMatchQuery) return null;
  return constructInvalidation(cq, doc);
}

function union<T>(...targets: (T[] | Set<T>)[]) {
  const result = new Set<T>();
  targets.forEach((target) => {
    target.forEach((val) => result.add(val));
  });
  return Array.from(result);
}

const MATCH_CACHE_KEY = /^Q:(.+?)(\[.*\])$/;
function parseCacheKey(key: string) {
  const [, hash, params] = key.match(MATCH_CACHE_KEY) || [];
  if (!hash || !params) throw Error('Failed to parse cache key');
  return {
    hash,
    params: JSON.parse(params) as unknown[],
  };
}

export default class InvalidationHandler {
  constructor(
    readonly context: Mondis,
  ) { }

  // TODO: add queueing mechanism for optimized invalidation batching?
  // TODO: implement 'blocking' hash key to prevent edge-case race conditions.
  onCacheEffect(effect: CacheEffect) {
    switch (effect.op) {
      case 'insert': return this.doInsertInvalidation(effect);
      case 'update': return this.doUpdateInvalidation(effect);
      case 'remove': return this.doRemoveInvalidation(effect);
      default: return null;
    }
  }

  private async doUpdateInvalidation(effect: CacheEffect & { op: 'update' }) {
    const keys = await this.fetchInvalidations(effect, getUpdateInvalidation);
    if (!keys.length) return;

    await this.invalidate(keys);
  }

  private async doInsertInvalidation(effect: CacheEffect & { op: 'insert' }) {
    const keys = await this.fetchInvalidations(effect, getInsertInvalidation);
    if (!keys.length) return;

    await this.invalidate(keys);
  }

  private async doRemoveInvalidation(effect: CacheEffect & { op: 'remove' }) {
    const { redis } = this.context;
    const { ids } = effect;
    const dependentKeys = await redis.sunion(
      ...ids.map((id) => `O:${String(id)}`),
      ...ids.map((id) => `P:${String(id)}`),
    );
    if (!dependentKeys.length) return; // nothing to do

    await this.invalidate(dependentKeys);
  }

  private async invalidate(keys: string[]) {
    if (!keys.length) return;

    const { redis } = this.context;
    const multi = redis.multi();
    keys.forEach((key) => multi.delquery(key));
    const results = await multi.exec();
    if (!results || !results.length) return;

    const keysInvalidated: string[] = [];
    results.forEach(([err, didExist], index) => {
      if (err !== null) return;
      const key = keys[index];
      if (key && didExist) keysInvalidated.push(key);
    });

    if (!keysInvalidated.length) return;
    await this.rehydrate(keysInvalidated);
  }

  private async rehydrate(keys: string[]) {
    if (!keys.length) return;

    const { lookupCachedQuery } = this.context;
    const promises = keys.map(async (key) => {
      const { hash, params } = parseCacheKey(key);
      const query = lookupCachedQuery.get(hash);
      if (!query || !query.config.rehydrate) return;
      await query.exec({ params, limit: query.config.cacheCount, skipCache: true });
    });

    await Promise.all(promises);
  }

  private async fetchInvalidations<D, E extends CacheEffect & { docs: D[] }>(
    effect: E,
    cb: (cq: CachedQuery, effect: E, doc: D) => KeyInvalidation | null,
  ): Promise<string[]> {
    const { lookupCachedQuery, redis } = this.context;
    const { docs } = effect;
    const keys = new Set<string>();
    const sets = new Set<string>();
    // eslint-disable-next-line no-restricted-syntax
    for (const query of lookupCachedQuery.values()) {
      docs.forEach((doc) => {
        const info = cb(query, effect, doc);
        // const info = getUpdateInvalidation(query, modelName, modified, before, after);
        if (!info) return;
        if ('all' in info) sets.add(`A:${info.hash}`);
        if ('keys' in info) info.keys.forEach((key) => keys.add(key));
      });
    }
    const fetchedKeys = (sets.size) ? await redis.sunion(...sets) : [];
    return union(keys, fetchedKeys);
  }
}
