import type { Query } from 'mongoose';
import { produce } from 'immer';
import { Timestamp } from 'bson';
import type { AnyObject } from '../types';
import { getValue, setValue, unsetValue, updateValue } from '../utils';

export type MongoOperators = Partial<Record<(typeof operators)[number], AnyObject>>;

export type MongooseQueryUpdate = ReturnType<Query<unknown, unknown>['getUpdate']>;

type ArrayUpdateOperator = {
  $each: unknown[];
  $position?: number | undefined;
  $slice?: number | undefined;
  $sort?: Record<string, -1 | 1>;
};

/**
 * TODO operations to support:
 * - $pull: requires expression evaluation (use sift?)
 * - $pullAll
 * - $bit
 * - array update modifiers: $sort
 */
const operators = [
  '$currentDate',
  '$inc',
  '$min',
  '$max',
  '$mul',
  '$rename',
  '$set',
  '$setOnInsert',
  '$unset',
  '$addToSet',
  '$pop',
  '$push',
] as const;

function parseArrayUpdateOperator(val: unknown): ArrayUpdateOperator {
  if (!val || typeof val !== 'object' || !('$each' in val)) return { $each: [val] };
  const { $each, $position, $slice, $sort } = val as ArrayUpdateOperator;
  if ($sort) throw Error('$sort is not a supported array update operation'); // TODO: implement sort
  if (!Array.isArray($each)) throw Error('$each value must be an array');
  if (typeof $position !== 'number' && $position !== undefined) throw Error('$position value must be a number');
  if (typeof $slice !== 'number' && $slice !== undefined) throw Error('$slice value must be a number');
  return { $each, $position, $slice };
}

function applyArrayUpdate(target: unknown[], val: unknown) {
  const {
    $each: items,
    $position: position,
    $slice: slice,
  } = parseArrayUpdateOperator(val);
  if (position === undefined) {
    target.push(...items);
  } else {
    target.splice(position, 0, ...items);
  }
  if (slice !== undefined) {
    if (slice >= 0) target.splice(slice);
    if (slice < 0) target.splice(0, target.length + slice);
  }
  return target;
}

const handlers = {
  $currentDate(target: {}, path: string, val: unknown) {
    const now = (function parseVal() {
      if (val === true || val === false) return new Date();
      const type = getValue(val, '$type');
      if (type === 'date') return new Date();
      if (type === 'timestamp') {
        return new Timestamp({ t: Date.now() / 1000, i: 1 });
      }
      throw Error('$currentDate value is invalid');
    }());
    setValue(target, path, now);
  },
  $inc(target: {}, path: string, val: unknown) {
    const num = (function parseVal() {
      if (typeof val === 'number' && !Number.isNaN(val)) return val;
      if (val === true) return 1;
      if (val === false) return 0;
      if (val instanceof Date) return val.valueOf();
      throw Error('$inc amount must be a numeric type');
    }());
    updateValue(target, path, (found: unknown) => {
      if (found === undefined) return val;
      if (typeof found === 'number') return found + num;
      throw Error('$inc target field must be a numeric type');
    });
  },
  $min(target: {}, path: string, val: unknown) {
    const current = getValue(target, path) as number;
    if ((val as number) < current) setValue(target, path, val);
  },
  $max(target: {}, path: string, val: unknown) {
    const current = getValue(target, path) as number;
    if ((val as number) > current) setValue(target, path, val);
  },
  $mul(target: {}, path: string, val: unknown) {
    if (typeof val !== 'number') throw Error('$mul target field must be a number');
    updateValue(target, path, (found: unknown) => {
      if (found === undefined) return 0;
      if (typeof found === 'number') return found * val;
      throw Error('$mul target field must be a numeric type');
    });
  },
  $rename(target: {}, path: string, val: unknown) {
    if (typeof val !== 'string') throw Error('$rename target field must be a string');
    const found: unknown = unsetValue(target, path);
    setValue(target, val, found);
  },
  $set(target: {}, path: string, val: unknown) {
    setValue(target, path, val);
  },
  $setOnInsert() {
    // No-op for an existing document, this is handled during upsert instead.
  },
  $unset(target: {}, path: string) {
    unsetValue(target, path);
  },
  $addToSet(target: {}, path: string, val: unknown) {
    const found: unknown = getValue(target, path);
    if (found === undefined) {
      setValue(target, path, [val]);
    } else if (Array.isArray(found)) {
      // TODO: support $each modifier + deep-equality object checking
      if (!found.includes(val)) found.push(val);
    } else {
      throw Error('$addToSet target field must be an array');
    }
  },
  $pop(target: {}, path: string, val: unknown) {
    const found: unknown = getValue(target, path);
    if (found === undefined) {
      /* do nothing */
    } else if (Array.isArray(found)) {
      if (val === 1 || val === true) {
        found.shift();
      } else if (val === -1) {
        found.pop();
      } else {
        throw Error('$pop value must be 1 or -1');
      }
    } else {
      throw Error('$pop target field must be an array');
    }
  },
  $push(target: {}, path: string, val: unknown) {
    const found: unknown = getValue(target, path);
    if (found === undefined) {
      const fresh = applyArrayUpdate([], val);
      setValue(target, path, fresh);
    } else if (Array.isArray(found)) {
      applyArrayUpdate(found, val);
    } else {
      throw Error('$push target field must be an array');
    }
  },
};

function isSupportedOperator(name: string): name is typeof operators[number] {
  return operators.includes(name as never);
}

function assertOperatorIsValid(key: string, val: unknown): asserts val is AnyObject {
  if (!val || typeof val !== 'object') throw Error(`Invalid operator value for ${key}`);
}

function getFilterValue(value: unknown): { add: boolean, value?: unknown } {
  if (value && typeof value === 'object') {
    const hasEqOp = '$eq' in value;
    if (hasEqOp) return { add: true, value: (value as AnyObject)['$eq'] };
    const someMongoOp = Object.keys(value).some((key) => key.startsWith('$'));
    if (someMongoOp) return { add: false };
  }
  return { add: true, value };
}

export function applyUpdates(targets: Array<{}>, update: MongoOperators) {
  Object.entries(update).forEach(([op, paths]) => {
    if (!isSupportedOperator(op)) throw Error(`Unsupported update operator ${op}`);
    const handler = handlers[op];
    Object.entries(paths).forEach(([path, val]) => {
      if (val === undefined) return;
      if (path.includes('.$')) throw Error('Updating arrays with <field>.$ is not supported');
      targets.forEach((target) => {
        handler(target, path, val);
      });
    });
  });
}

export function parseQueryUpdate(input: MongooseQueryUpdate) {
  if (!input) return {};
  if (Array.isArray(input)) throw Error('Updating with aggregation pipeline is not supported');
  const result: MongoOperators = {};
  function addEntriesToSetOp(...entries: [string, unknown][]) {
    if (!result.$set) result.$set = {};
    for (const [key, val] of entries) { result.$set[key] = val; }
  }
  Object.entries(input).forEach(([key, val]) => {
    if (key.charAt(0) !== '$') {
      addEntriesToSetOp([key, val]);
    } else if (isSupportedOperator(key)) {
      if (!val) return;
      assertOperatorIsValid(key, val);
      if (key === '$set') { // handle separately to merge with top-level fields
        addEntriesToSetOp(...Object.entries(val));
      } else {
        result[key] = { ...val };
      }
    } else {
      throw Error(`Unsupported update operator ${key}`);
    }
  });
  return result;
}

export function collectModifiedKeys(update: MongoOperators) {
  const result = new Set<string>();
  Object.values(update).forEach((paths) => {
    Object.keys(paths).forEach((path) => result.add(path));
  });
  return Array.from(result);
}

export function buildUpsertedDocument(filter: AnyObject, update: MongoOperators) {
  const doc: AnyObject = {};
  // Find keys from `filter` that should be `$set` in the upserted doc
  Object.entries(filter).forEach(([field, rawValue]) => {
    const { add, value } = getFilterValue(rawValue);
    if (add) doc[field] = value;
  });
  // Merge $setOnInsert into $set, since they are the same during upsert
  const { $set, $setOnInsert } = update;
  applyUpdates([doc], { ...update, $set: { ...$set, ...$setOnInsert } });
  return doc;
}

export function mapBeforeAndAfter<T extends {}>(targets: T[], update: MongoOperators) {
  return produce(targets, (draft) => {
    applyUpdates(draft, update);
  }).map((after, idx) => ({ before: targets[idx]!, after }));
}
