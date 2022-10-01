import sift from 'sift';
import type CachedQuery from '..';
import type {
  AnyObject,
  QueryFilter,
  QueryProjection,
  QuerySelectInfo,
  QueryFilterInfo,
  CacheEffect,
  QueryPopulation,
  HasObjectId,
} from '../types';
import {
  LazyArrayMap,
} from '../utils';

export type InvalidationMaps = {
  primary: Map<string, InvalidationInfo[]>;
  populated: Map<string, PopulatedInvalidationInfo[]>;
};

export type KeyInvalidation =
  | { hash: string, all: true }
  | { hash: string, keys: string[] };

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
  let inclusive: boolean | undefined;
  Object.entries(project).forEach(([path, value]) => {
    if (value !== 0 && value !== 1) throw Error('Query select values must be 0 or 1');
    const inclusiveOp = (value === 1);
    if (path === '_id') {
      if (value !== 1) throw Error('Excluding _id from projection is forbidden');
    } else {
      if (inclusive === undefined) {
        inclusive = inclusiveOp;
      } else if (inclusive !== inclusiveOp) {
        throw Error('Cannot mix inclusive and exclusive projection');
      }
      paths.push(path);
    }
  });
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

export class InvalidationInfo {
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
    effect: CacheEffect & { op: 'update' },
  ): KeyInvalidation | null {
    const { matcher, selectInclusive, selectPaths, sortPaths } = this;
    const { modified } = effect;
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

  getInsertInvalidation(doc: AnyObject): KeyInvalidation | null {
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

  constructInvalidation(...docs: AnyObject[]): KeyInvalidation {
    const { cachedQuery, complexQuery, dynamicKeys } = this;
    // If any configurable part of the query is not just an equality check,
    // we have to invalidate all queries, because we don't know if it has changed.
    if (complexQuery) return { hash: cachedQuery.hash, all: true };
    const keys = docs.map((doc) => {
      // Otherwise, just reconstruct the cache key to only invalidate queries with matching params
      // TODO: use getValue to support dot-notation?
      // check with `classifyQuery`, can `dynamicKeys` be dot-notation?
      const params = dynamicKeys.map((key) => doc[key]);
      return cachedQuery.getCacheKey(params);
    });
    return { hash: cachedQuery.hash, keys };
  }
}

export class PopulatedInvalidationInfo {
  readonly selectInclusive: boolean;
  readonly selectPaths: string[];

  constructor(readonly cachedQuery: CachedQuery, populate: QueryPopulation) {
    const { select = {} } = populate;
    const { selectInclusive, selectPaths } = classifyProjection(select);
    this.selectInclusive = selectInclusive;
    this.selectPaths = selectPaths;
  }

  // TODO: might have to use HasObjectId instead of AnyObject
  getUpdateInvalidation(
    doc: { before: HasObjectId, after: HasObjectId },
    effect: CacheEffect & { op: 'update' },
  ) {
    const { selectInclusive, selectPaths } = this;
    const { modified } = effect;
    const { after } = doc;
    if (wasProjectionModified(selectInclusive, selectPaths, modified)) {
      return { set: `P:${String(after._id)}`, hash: this.cachedQuery.hash };
    }
    return null;
  }
}

export function buildInvalidationMaps(cachedQueries: CachedQuery[]): InvalidationMaps {
  const infoPrimary = new LazyArrayMap<InvalidationInfo>();
  const infoPopulate = new LazyArrayMap<PopulatedInvalidationInfo>();
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
