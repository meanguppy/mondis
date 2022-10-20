import sift from 'sift';
import type CachedQuery from '..';
import type {
  AnyObject,
  QueryFilter,
  QueryProjection,
  QuerySelectInfo,
  QueryFilterInfo,
  QueryPopulation,
  HasObjectId,
} from '../types';
import { ArrayMap, getValue } from '../utils';

export type InvalidationMaps = {
  primary: Map<string, InvalidationInfo[]>;
  populated: Map<string, PopulatedInvalidationInfo[]>;
};

export type CollectedInvalidations = {
  keys?: string[];
  sets?: { set: string, filter?: string }[];
};

type InvalidationTarget =
  | null
  | { keys: string[] }
  | { set: string, filter?: string };

function wasProjectionModified(
  inclusive: boolean,
  selected: string[],
  modifiedPaths: string[],
) {
  if (!modifiedPaths.length) return false;
  if (!selected.length) return !inclusive;
  if (inclusive) {
    // inclusive: return true if some prefix in paths was in modified.
    return modifiedPaths.some(
      (modified) => selected.find(
        (path) => modified === path
          || modified.startsWith(`${path}.`)
          || path.startsWith(`${modified}.`),
      ),
    );
  }
  // exclusive: return true if some prefix in modified was not found in paths.
  return !modifiedPaths.every(
    (modified) => selected.find(
      (path) => modified === path || modified.startsWith(`${path}.`),
    ),
  );
}

// TODO: think about how $slice/$elemMatch/`.$` interacts with this.
function classifyProjection(project: QueryProjection): QuerySelectInfo {
  const paths: string[] = [];
  let selectedId = false;
  let inclusive: boolean | undefined;
  Object.entries(project).forEach(([path, value]) => {
    if (value !== 0 && value !== 1) throw Error('Query select values must be 0 or 1');
    const inclusiveOp = (value === 1);
    if (path === '_id') {
      if (value !== 1) throw Error('Excluding _id from projection is forbidden');
      selectedId = true;
    } else {
      if (inclusive === undefined) {
        inclusive = inclusiveOp;
      } else if (inclusive !== inclusiveOp) {
        throw Error('Cannot mix inclusive and exclusive projection');
      }
      paths.push(path);
    }
  });
  if (inclusive === undefined && selectedId) {
    return { selectInclusive: true, selectPaths: ['_id'] };
  }
  return { selectInclusive: !!inclusive, selectPaths: paths };
}

/**
 * Classifies all keys in the query:
 * - Which keys are static and which are configurable?
 * - Is any configurable query complex (not an equality comparison)?
 */
function classifyQuery<P extends unknown[]>(
  input: QueryFilter | ((...args: P) => QueryFilter),
): QueryFilterInfo {
  if (input && typeof input === 'object') {
    return { matcher: sift<unknown>(input), dynamicKeys: [], complexQuery: false };
  }
  // map params to objects, used to compare by reference without risk of ambiguous comparison
  const params = Array(input.length).fill(null).map(() => ({})) as P;
  const query = input(...params);

  // recursively search query object for parameters (empty objects)
  let complexQuery = false;
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

  const staticKeys: AnyObject = {};
  Object.entries(query).forEach(([k, v]) => {
    if (!dynamicKeys.includes(k)) {
      staticKeys[k] = v;
    }
  });

  return { matcher: sift(staticKeys), dynamicKeys, complexQuery };
}

class InvalidationInfo {
  readonly matcher: ReturnType<typeof sift>;
  readonly dynamicKeys: string[];
  readonly complexQuery: boolean;
  readonly selectInclusive: boolean;
  readonly selectPaths: string[];
  readonly sortPaths: string[];

  constructor(readonly cachedQuery: CachedQuery) {
    const { query, select, sort } = cachedQuery.config;
    const { matcher, dynamicKeys, complexQuery } = classifyQuery(query);
    const { selectInclusive, selectPaths } = classifyProjection(select);
    this.matcher = matcher;
    this.dynamicKeys = dynamicKeys;
    this.complexQuery = complexQuery;
    this.selectInclusive = selectInclusive;
    this.selectPaths = selectPaths;
    this.sortPaths = sort ? Object.keys(sort) : [];
  }

  getUpdateInvalidation(
    doc: { before: HasObjectId, after: HasObjectId },
    modified: string[],
  ): InvalidationTarget {
    const { matcher, selectInclusive, selectPaths, sortPaths } = this;
    const { before, after } = doc;
    const wasMatch = matcher(before);
    const nowMatch = matcher(after);
    if (wasMatch && nowMatch) {
    // NOTE: `sort` can be modeled as an inclusive select for the sake of
    // deciding whether the sorting of the query was altered.
      if (wasProjectionModified(true, sortPaths, modified)
    || wasProjectionModified(selectInclusive, selectPaths, modified)) {
        return this.constructInvalidation(before, after);
      }
    } else if (!wasMatch && nowMatch) {
      return this.constructInvalidation(after);
    } else if (wasMatch && !nowMatch) {
      return this.constructInvalidation(before);
    }
    return null;
  }

  getInsertInvalidation(doc: AnyObject): InvalidationTarget {
    const { cachedQuery, matcher } = this;
    const { unique, invalidateOnInsert } = cachedQuery.config;
    // If this query uniquely identifies a single document,
    // then a new document will have no effect on cached queries.
    if (unique || !invalidateOnInsert) return null;
    // If any field in the document contradicts the query, no need to invalidate
    const docCouldMatchQuery = matcher(doc);
    if (!docCouldMatchQuery) return null;
    return this.constructInvalidation(doc);
  }

  constructInvalidation(...docs: AnyObject[]): InvalidationTarget {
    const { cachedQuery, complexQuery, dynamicKeys } = this;
    // If any configurable part of the query is not just an equality check,
    // we have to invalidate all queries, because we don't know if it has changed.
    if (complexQuery) return { set: `A:${cachedQuery.hash}` };
    // Otherwise, reconstruct the cache keys to only invalidate queries with relevant params.
    const keySet = new Set<string>();
    for (const doc of docs) {
      const params: unknown[] = [];
      for (const key of dynamicKeys) {
        const value = getValue(doc, key);
        // If the value is an array, we should just invalidate all instead,
        // because a doc with `key: [1,2,3]` can be matched with `key: 1`.
        // TODO: it is possible to expand the array into one key per item.
        if (Array.isArray(value)) return { set: `A:${cachedQuery.hash}` };
        params.push(value);
      }
      keySet.add(cachedQuery.getCacheKey(params));
    }
    return { keys: Array.from(keySet) };
  }
}

class PopulatedInvalidationInfo {
  readonly selectInclusive: boolean;
  readonly selectPaths: string[];

  constructor(readonly cachedQuery: CachedQuery, populate: QueryPopulation) {
    const { select = {} } = populate;
    const { selectInclusive, selectPaths } = classifyProjection(select);
    this.selectInclusive = selectInclusive;
    this.selectPaths = selectPaths;
  }

  getUpdateInvalidation(
    doc: { before: HasObjectId, after: HasObjectId },
    modified: string[],
  ): InvalidationTarget {
    const { cachedQuery, selectInclusive, selectPaths } = this;
    const { after } = doc;
    if (wasProjectionModified(selectInclusive, selectPaths, modified)) {
      return { set: `P:${String(after._id)}`, filter: cachedQuery.hash };
    }
    return null;
  }
}

export function buildInvalidationMaps(cachedQueries: CachedQuery[]): InvalidationMaps {
  const infoPrimary = new ArrayMap<string, InvalidationInfo>();
  const infoPopulate = new ArrayMap<string, PopulatedInvalidationInfo>();
  cachedQueries.forEach((cachedQuery) => {
    const { model, populate } = cachedQuery.config;
    infoPrimary.add(model, new InvalidationInfo(cachedQuery));
    function collectPopulations(input: QueryPopulation) {
      const { model: modelPopulate, populate: innerPopulate } = input;
      infoPopulate.add(
        modelPopulate,
        new PopulatedInvalidationInfo(cachedQuery, input),
      );
      innerPopulate?.forEach((pop) => collectPopulations(pop));
    }
    populate?.forEach((pop) => collectPopulations(pop));
  });
  return { primary: infoPrimary.map, populated: infoPopulate.map };
}

export function collectInvalidations(
  callback: (add: (target: InvalidationTarget) => void) => void,
): CollectedInvalidations {
  const keys = new Set<string>();
  const sets = new Set<string>();
  function addHandler(target: InvalidationTarget) {
    if (target === null) return;
    if ('keys' in target) {
      target.keys.forEach((key) => keys.add(key));
    }
    if ('set' in target) {
      const { set, filter } = target;
      if (filter) {
        sets.add(`${set},${filter}`);
      } else {
        sets.add(set);
      }
    }
  }
  callback(addHandler);
  return {
    keys: Array.from(keys),
    sets: Array.from(sets, (str) => {
      const split = str.split(',');
      if (split.length >= 2) return { set: split[0]!, filter: split[1]! };
      return { set: split[0]! };
    }),
  };
}
