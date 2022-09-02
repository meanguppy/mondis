import type CachedQuery from '.';
import type { HasObjectId } from './types';

type InsertInvalidation =
  | { key: string }
  | { set: string }
  | null;

export function union<T>(a: T[], b: T[]) {
  return Array.from(new Set([...a, ...b]));
}

export function okForComparison(val: unknown) {
  const t = (typeof val);
  return (val === null || t !== 'object') && t !== 'function';
}

/**
 * Returns the cache keys that need to be invalidated when an insert event occurs.
 */
export function getInsertInvalidation(
  cq: CachedQuery<unknown>,
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

// export function collectInsertInvalidations<T extends Record<string, unknown>>(
//   model: string,
//   doc: T,
// ) {
//   const keys = [];
//   const sets = [];
//   allQueries.forEach((query) => {
//     const info = getInsertInvalidation(query, model, doc);
//     if (!info) return;
//     if (info.key) keys.push(info.key);
//     if (info.set) sets.push(info.set);
//   });
//   return { keys, sets };
// }

export function parseParamsFromQueryKey(key: string) {
  const result = key.match(/^q:[^[]+(.+?)$/);
  try {
    const match = result && result[1];
    if (match) {
      return JSON.parse(match) as unknown[];
    }
  } catch (err) {
    // logger.warn({ err, tag: 'CACHE_INVALIDATION_ERROR' }, 'Failed to parse JSON');
  }
  return [];
}

export function findCachedQueryByKey(key: string, allQueries: CachedQuery<unknown>[]) {
  const match = key.match(/^q:(.*?)\[/);
  if (match && match[1]) {
    const found = allQueries.find((cq) => cq.hash === match[1]);
    if (found) return found;
  }
  return null;
}

// export async function invalidate(
//   ctx: Mondis,
//   allQueries: CachedQuery<unknown>[],
//   keys: string[],
//   rehydrate = true,
// ) {
//   if (!keys.length) return;
//
//   const { redis } = ctx;
//   const multi = redis.multi();
//   keys.forEach((key) => multi.call('delquery', key));
//   const results = await multi.exec();
//
//   if (!rehydrate || !results) return;
//
//   const callables: Array<() => Promise<void>> = [];
//   results.forEach((didExist, index) => {
//     const key = keys[index];
//     if (!didExist || !key) return; // key didnt exist on cache, do not rehydrate
//     const query = findCachedQueryByKey(key, allQueries);
//     if (!query || !query.rehydrate) return;
//
//     const params = parseParamsFromQueryKey(key);
//     callables.push(async () => {
//       try {
//         await query.exec({ params, limit: query.cacheCount, skipCache: true });
//       } catch (err) {
//         // logger
//       }
//     });
//   });
//
//   // if there are no queries to rehydrate, exit early
//   if (!callables.length) return;
//
//   // start and await all promises
//   await Promise.all(callables.map((func) => func()));
// }
