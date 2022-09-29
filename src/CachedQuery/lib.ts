import { Types } from 'mongoose';
import crypto from 'crypto';
import sift from 'sift';
import type {
  AnyObject,
  QueryFilter,
  HasObjectId,
  QueryPopulation,
  QueryProjection,
  QueryInfo,
} from './types';

function walk(
  target: unknown,
  path: string,
  buildPath: boolean,
  cb: (found: AnyObject, key: string) => void,
) {
  if (target == null) return;
  const split = path.split('.');
  const key = split[0] || '';

  if (split.length === 1) {
    cb(target as AnyObject, key);
  } else {
    const nextTarget = (target as AnyObject)[key];
    if (buildPath && nextTarget == null) {
      (target as AnyObject)[key] = {};
    }
    const remainder = split.slice(1).join('.');
    walk(nextTarget, remainder, buildPath, cb);
  }
}

export function updateValue(target: unknown, path: string, cb: (value: unknown) => unknown) {
  walk(target, path, true, (found, key) => { found[key] = cb(found[key]); });
}

export function setValue(target: unknown, path: string, value: unknown) {
  walk(target, path, true, (found, key) => { found[key] = value; });
}

export function unsetValue(target: unknown, path: string) {
  let result: unknown;
  walk(target, path, false, (found, key) => {
    result = found[key];
    delete found[key];
  });
  return result;
}

export function getValue(target: unknown, path: string) {
  let result: unknown;
  walk(target, path, false, (found, key) => { result = found[key]; });
  return result;
}

export function hasObjectId(target: unknown): target is HasObjectId {
  return !!(
    target
    && typeof target === 'object'
    && (target as { _id?: unknown })._id instanceof Types.ObjectId
  );
}

/**
 * Extract all ObjectIds of documents based on the
 * mongoose population config. Embedded documents not included
 */
// TODO: separate top-level ids from populated ids
export function collectPopulatedIds(
  docs: Partial<HasObjectId>[],
  populations?: QueryPopulation[],
) {
  const initial = docs.filter((doc) => !!doc._id).map((doc) => String(doc._id));
  if (!populations?.length) return initial;
  const result = new Set(initial);

  docs.forEach((doc) => {
    populations.forEach(({ path, populate: innerPopulate }) => {
      const inner = getValue(doc, path);
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

// TODO: think about how $slice/$elemMatch/`.$` interacts with this.
export function classifyProjection(project: QueryProjection): QueryInfo['select'] {
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
  return { inclusive: !!inclusive, paths };
}

/**
 * Classifies all keys in the query:
 * - Which keys are static and which are configurable?
 * - Is any configurable query complex (not an equality comparison)?
 */
export function classifyQuery<P extends unknown[]>(
  input: QueryFilter | ((...args: P) => QueryFilter),
): QueryInfo['query'] {
  if (input && typeof input === 'object') {
    return { matcher: sift<unknown>(input), dynamicKeys: [], complexQuery: false };
  }
  if (!input || typeof input !== 'function') throw Error('Bad query configuration');

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

export function jsonHash(input: unknown) {
  const json = JSON.stringify(input);
  return crypto
    .createHash('sha1')
    .update(json)
    .digest('base64')
    .substring(0, 16);
}
