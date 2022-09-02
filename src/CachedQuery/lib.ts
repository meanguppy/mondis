import { Types } from 'mongoose';
import { get } from 'lodash';
import crypto from 'crypto';
import type {
  HasObjectId,
  MongoosePopulation,
  QueryKeysClassification,
} from './types';

export function hasObjectId(target: unknown): target is HasObjectId {
  return (
    !!target
    && typeof target === 'object'
    && (target as { _id?: unknown })._id instanceof Types.ObjectId
  );
}

/**
 * Extract all ObjectIds of documents based on the
 * mongoose population config. Embedded documents not included
 */
export function collectPopulatedIds(
  docs: Partial<HasObjectId>[],
  populations?: MongoosePopulation[],
) {
  const initial = docs.filter((doc) => !!doc._id).map((doc) => String(doc._id));
  if (!populations?.length) return initial;
  const result = new Set(initial);

  docs.forEach((doc) => {
    populations.forEach(({ path, populate: innerPopulate }) => {
      const inner: unknown = get(doc, path);
      if (!inner || typeof inner !== 'object') return;

      const items: unknown[] = Array.isArray(inner) ? inner : [inner];
      items.forEach((innerVal) => {
        if (!hasObjectId(innerVal)) return;
        if (innerPopulate) {
          collectPopulatedIds([innerVal], innerPopulate).forEach((id) => result.add(id));
        } else {
          result.add(String(innerVal._id));
        }
      });
    });
  });

  return [...result];
}

/**
 * Splices an array to emulate skipping and limiting, with safe params.
 */
export function skipAndLimit<T>(array: T[], skip?: number, limit?: number) {
  skip = (typeof skip === 'number') ? skip : 0;
  limit = (typeof limit === 'number') ? limit : undefined;
  if (skip < 0) throw Error('Skip must be zero or a positive integer');
  if (limit !== undefined && limit <= 0) throw Error('Limit must be a positive integer');
  if (skip > 0 || limit) {
    return array.slice(skip, limit ? (skip + limit) : undefined);
  }
  return array;
}

/**
 * Classifies all keys in the query:
 *   Which keys are static and which are configurable?
 *   Is any configurable query complex (not a string comparison)?
 */
export function classifyQueryKeys(
  query: Record<string, unknown> | ((...params: unknown[]) => Record<string, unknown>),
): QueryKeysClassification {
  let complexQuery = false;
  if (query && typeof query === 'object') {
    return { staticKeys: query, dynamicKeys: [], complexQuery };
  }

  // map params to objects, used to compare by reference without risk of ambiguous comparison
  const params = Array(query.length).fill(null).map(() => ({}));
  query = query(...params);

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
    if (!dynamicKeys.includes(k)) {
      staticKeys[k] = v;
    }
  });

  return { staticKeys, dynamicKeys, complexQuery };
}

export function jsonHash(input: unknown) {
  const json = JSON.stringify(input);
  return crypto
    .createHash('sha1')
    .update(json)
    .digest('base64')
    .substring(0, 16);
}
