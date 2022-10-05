import { EJSON } from 'bson';
import { Types } from 'mongoose';
import crypto from 'crypto';
import type {
  AnyObject,
  HasObjectId,
  QueryPopulation,
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
export function collectPopulatedIds(
  docs: AnyObject[],
  populations: QueryPopulation[],
) {
  if (!populations.length) return [];
  const result = new Set<string>();

  docs.forEach((doc) => {
    populations.forEach(({ path, populate: innerPopulate }) => {
      const inner = getValue(doc, path);
      if (!inner || typeof inner !== 'object') return;

      const items: unknown[] = Array.isArray(inner) ? inner : [inner];
      items.forEach((innerVal) => {
        if (!hasObjectId(innerVal)) return;
        result.add(String(innerVal._id));
        if (!innerPopulate) return;
        collectPopulatedIds([innerVal], innerPopulate).forEach((id) => result.add(id));
      });
    });
  });

  return Array.from(result);
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

export function jsonHash(input: AnyObject) {
  const ejson = EJSON.stringify(input);
  return crypto
    .createHash('sha1')
    .update(ejson)
    .digest('base64')
    .substring(0, 16);
}

export function union<T>(...targets: (T[] | Set<T>)[]) {
  const result = new Set<T>();
  targets.forEach((target) => {
    target.forEach((val) => result.add(val));
  });
  return Array.from(result);
}

export class ArrayMap<K, V> {
  map = new Map<K, V[]>();

  add(key: K, item: V) {
    const array = this.map.get(key);
    if (array) {
      array.push(item);
    } else {
      this.map.set(key, [item]);
    }
  }
}
