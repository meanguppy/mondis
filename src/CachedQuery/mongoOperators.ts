import { getValue, setValue, unsetValue, updateValue } from './lib';

type MongoOperators = Record<(typeof operators)[number], Record<string, unknown>>;

const operators = [
  '$inc',
  '$min',
  '$max',
  '$mul',
  '$rename',
  '$set',
  '$unset',
  '$addToSet',
  '$pop',
  '$push',
] as const;

const handlers = {
  $inc(target: {}, path: string, val: unknown) {
    const num = (() => {
      if (typeof val === 'number' && !Number.isNaN(val)) return val;
      if (val === true) return 1;
      if (val === false) return 0;
      if (val instanceof Date) return val.valueOf();
      throw Error('$inc amount must be a numeric type');
    })();
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
  $unset(target: {}, path: string) {
    unsetValue(target, path);
  },
  $addToSet(target: {}, path: string, val: unknown) {
    const found: unknown = getValue(target, path);
    if (found === undefined) {
      setValue(target, path, [val]);
    } else if (Array.isArray(found)) {
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
      setValue(target, path, [val]);
    } else if (Array.isArray(found)) {
      found.push(val);
    } else {
      throw Error('$push target field must be an array');
    }
  },
};

function isSupportedOperator(name: string): name is typeof operators[number] {
  return operators.includes(name as never);
}

function parseOperatorsObject(input: Record<string, unknown>): Partial<MongoOperators> {
  const hasField = Object.keys(input).some((str) => str.charAt(0) !== '$');
  return hasField ? { $set: input } : input;
}

export function applyUpdates(targets: Array<{}>, input: Record<string, unknown>) {
  const ops = parseOperatorsObject(input);
  Object.entries(ops).forEach(([op, paths]) => {
    if (!isSupportedOperator(op)) throw Error(`Unsupported update operator ${op}`);
    const handler = handlers[op];
    Object.entries(paths).forEach(([path, val]) => {
      if (val === undefined) return;
      targets.forEach((target) => {
        handler(target, path, val);
      });
    });
  });
}
