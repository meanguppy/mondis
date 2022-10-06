import { Timestamp } from 'bson';
import {
  buildUpsertedDocument,
  applyUpdates,
  type MongoOperators,
} from '../src/CachedQuery/invalidation/mongo-operators';

type AnyObject = Record<string, unknown>;

type TestCaseStruct = {
  [op: string]: Array<[AnyObject, MongoOperators, AnyObject]>;
};

const GoodTestCases: TestCaseStruct = {
  $inc: [
    [{}, { $inc: { n: 1 } }, { n: 1 }],
    [{ n: 0 }, { $inc: { n: 5 } }, { n: 5 }],
    [{ n: 10 }, { $inc: { n: 8 } }, { n: 18 }],
    [{ n: 15 }, { $inc: { n: 0 } }, { n: 15 }],
    [{ n: 30 }, { $inc: { n: -20 } }, { n: 10 }],
    [{ n: 50 }, { $inc: { n: true } }, { n: 51 }],
    [{ n: 50 }, { $inc: { n: false } }, { n: 50 }],
    [{ n: 1000 }, { $inc: { n: new Date(20000) } }, { n: 21000 }],
  ],
  $min: [
    [{ n: 0 }, { $min: { n: 5 } }, { n: 0 }],
    [{ n: 10 }, { $min: { n: 8 } }, { n: 8 }],
    [{ n: 15 }, { $min: { n: 0 } }, { n: 0 }],
    [{ n: 30 }, { $min: { n: -20 } }, { n: -20 }],
  ],
  $max: [
    [{ n: 0 }, { $max: { n: 5 } }, { n: 5 }],
    [{ n: 10 }, { $max: { n: 8 } }, { n: 10 }],
    [{ n: 15 }, { $max: { n: 0 } }, { n: 15 }],
    [{ n: 30 }, { $max: { n: -20 } }, { n: 30 }],
  ],
  $mul: [
    [{}, { $mul: { n: 5 } }, { n: 0 }],
    [{ n: 0 }, { $mul: { n: 5 } }, { n: 0 }],
    [{ n: 10 }, { $mul: { n: 8 } }, { n: 80 }],
    [{ n: 15 }, { $mul: { n: 0 } }, { n: 0 }],
    [{ n: 30 }, { $mul: { n: -20 } }, { n: -600 }],
  ],
  $rename: [
    [{}, { $rename: { a: 'b' } }, {}],
    [{ a: 1 }, { $rename: { a: 'b' } }, { b: 1 }],
    [{ a: { b: 1 } }, { $rename: { 'a.b': 'c' } }, { a: {}, c: 1 }],
  ],
  $set: [
    [{ a: 1 }, { $set: { a: 2 } }, { a: 2 }],
    [{ a: 1 }, { $set: { b: 2 } }, { a: 1, b: 2 }],
    [{ a: 1 }, { $set: { a: undefined } }, { a: 1 }],
    [{ a: { b: 1 } }, { $set: { 'a.b': 2 } }, { a: { b: 2 } }],
  ],
  $setOnInsert: [
    [{ a: 1 }, { $setOnInsert: { b: 2 } }, { a: 1 }], // no-op during update, upsert only
  ],
  $unset: [
    [{}, { $unset: { a: 1 } }, {}],
    [{ a: 1 }, { $unset: { a: 0 } }, {}],
    [{ a: 1 }, { $unset: { b: 1 } }, { a: 1 }],
    [{ a: { b: { c: 1 } } }, { $unset: { 'a.b.c': true } }, { a: { b: {} } }],
  ],
  $addToSet: [
    [{}, { $addToSet: { a: 1 } }, { a: [1] }],
    [{ a: [1, 2, 3] }, { $addToSet: { a: 4 } }, { a: [1, 2, 3, 4] }],
    [{ a: [1, 2, 3] }, { $addToSet: { a: 3 } }, { a: [1, 2, 3] }],
    [{ a: [1, 2, 3] }, { $addToSet: { a: 'hello' } }, { a: [1, 2, 3, 'hello'] }],
  ],
  $pop: [
    [{}, { $pop: { a: 1 } }, {}],
    [{ a: [1, 2, 3] }, { $pop: { a: 1 } }, { a: [2, 3] }],
    [{ a: [1, 2, 3] }, { $pop: { a: -1 } }, { a: [1, 2] }],
    [{ a: [1, 2, 3] }, { $pop: { a: true } }, { a: [2, 3] }],
  ],
  $push: [
    [{}, { $push: { a: 1 } }, { a: [1] }],
    [{ a: [1, 2, 3] }, { $push: { a: 4 } }, { a: [1, 2, 3, 4] }],
    [{ a: [1, 2, 3] }, { $push: { a: 3 } }, { a: [1, 2, 3, 3] }],
    [{ a: [1, 2, 3] }, { $push: { a: 'hello' } }, { a: [1, 2, 3, 'hello'] }],
    [{ a: [1, 2] }, { $push: { a: { $each: [3, 9] } } }, { a: [1, 2, 3, 9] }],
    [{ a: [1, 2] }, { $push: { a: { $each: [4, 5], $position: 0 } } }, { a: [4, 5, 1, 2] }],
    [{ a: [1, 2, 3] }, { $push: { a: { $each: [9], $position: -1 } } }, { a: [1, 2, 9, 3] }],
    [{ a: [1, 2] }, { $push: { a: { $each: [3, 9], $slice: 3 } } }, { a: [1, 2, 3] }],
    [{ a: [1, 2] }, { $push: { a: { $each: [3, 9], $slice: -3 } } }, { a: [2, 3, 9] }],
  ],
};

function immutUpdate<T = AnyObject>(input: AnyObject, op: MongoOperators) {
  const cloned = { ...input };
  applyUpdates([cloned], op);
  return cloned as unknown as T;
}

describe('Mongo update operators', () => {
  it('$currentDate', () => {
    function expectFieldInstance(value: unknown, instance: unknown) {
      expect(immutUpdate({}, { $currentDate: { a: value } })['a']).toBeInstanceOf(instance);
    }
    expectFieldInstance(true, Date);
    expectFieldInstance(false, Date);
    expectFieldInstance({ $type: 'date' }, Date);
    expectFieldInstance({ $type: 'timestamp' }, Timestamp);
  });

  Object.entries(GoodTestCases).forEach(([name, cases]) => {
    it(name, () => {
      cases.forEach(([input, op, output]) => {
        expect(immutUpdate(input, op)).toEqual(output);
      });
    });
  });

  it('can build upserted document', () => {
    buildUpsertedDocument({}, {});
  });
});
