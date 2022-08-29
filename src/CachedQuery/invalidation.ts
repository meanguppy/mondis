import type Mondis from 'src';
import type CachedQuery from '.';

type InsertInvalidation =
  | { key: string }
  | { set: string }
  | null;

type QueryKeysClassification = {
  staticKeys: { [name: string]: unknown };
  dynamicKeys: string[];
  complexQuery: boolean;
};

export function union<T>(a: T[], b: T[]) {
  return Array.from(new Set([...a, ...b]));
}

export function okForComparison(val: unknown) {
  const t = (typeof val);
  return (val === null || t !== 'object') && t !== 'function';
}

/**
 * Classifies all keys in the query:
 *   Which keys are static and which are configurable?
 *   Is any configurable query complex (not a string comparison)?
 */
export function classifyQueryKeys<T>(queryFunc: CachedQuery<T>['query']): QueryKeysClassification {
  let complexQuery = false;
  if (queryFunc && typeof queryFunc === 'object') {
    return { staticKeys: queryFunc, dynamicKeys: [], complexQuery };
  }

  // map params to objects, used to compare by reference without risk of ambiguous comparison
  const params = Array(queryFunc.length).fill(null).map(() => ({}));
  const query = queryFunc(...params);

  // recursively search query object for parameters (empty objects)
  const dynamicKeys: string[] = [];
  function findParam(key: string, target: unknown, inside = false) {
    if (!target || typeof target !== 'object') return;
    const paramIdx = params.indexOf(target);
    if (paramIdx >= 0) {
      if (inside) complexQuery = true;
      dynamicKeys[paramIdx] = key;
    } else {
      Object.values(target).forEach((v) => findParam(key, v, true));
    }
  }
  Object.entries(query).forEach(([k, v]) => findParam(k, v));

  const staticKeys: Record<string, unknown> = {};
  Object.entries(query).forEach(([k, v]) => {
    if (dynamicKeys.indexOf(k) === -1) {
      staticKeys[k] = v;
    }
  });

  return { staticKeys, dynamicKeys, complexQuery };
}

/**
 * Returns the cache keys that need to be invalidated when an insert event occurs.
 */
export function getInsertInvalidation<T extends Record<string, unknown>>(
  cq: CachedQuery<T>,
  model: string,
  doc: T,
): InsertInvalidation {
  // If this query uniquely identifies a single document,
  // then a new document will have no effect on cached queries.
  if (cq.unique || !cq.invalidateOnInsert || cq.model !== model) return null;

  const { staticKeys, dynamicKeys, complexQuery } = classifyQueryKeys(cq.query);
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

export async function invalidate(
  ctx: Mondis,
  allQueries: CachedQuery<unknown>[],
  keys: string[],
  rehydrate = true,
) {
  if (!keys.length) return;

  const { redis } = ctx.clients;
  const multi = redis.multi();
  keys.forEach((key) => multi.call('delquery', key));
  const results = await multi.exec();

  if (!rehydrate || !results) return;

  const callables: Array<() => Promise<void>> = [];
  results.forEach((didExist, index) => {
    const key = keys[index];
    if (!didExist || !key) return; // key didnt exist on cache, do not rehydrate
    const query = findCachedQueryByKey(key, allQueries);
    if (!query || !query.rehydrate) return;

    const params = parseParamsFromQueryKey(key);
    callables.push(async () => {
      try {
        await query.exec({ params, limit: query.cacheCount, skipCache: true });
      } catch (err) {
        // logger
      }
    });
  });

  // if there are no queries to rehydrate, exit early
  if (!callables.length) return;

  // open Mongoose connection and ensure all models are available
  // const existingModels = mongoose.modelNames();
  // Object.keys(allSchemas).forEach((schemaName) => {
  //   if (!existingModels.includes(schemaName)) {
  //     mongoose.model(schemaName, allSchemas[schemaName]);
  //   }
  // });

  // start and await all promises
  await Promise.all(callables.map((func) => func()));
}
