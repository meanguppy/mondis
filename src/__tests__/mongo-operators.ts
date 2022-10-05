import {
  buildUpsertedDocument,
  applyUpdateQuery,
  type MongooseQueryUpdate,
  type MongoOperators,
} from '../CachedQuery/invalidation/mongo-operators';

type AnyObject = Record<string, unknown>;

type TestCaseStruct = {
  [op: string]: Array<[AnyObject, Partial<MongoOperators>, AnyObject]>;
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
    [{ a: 1 }, { $setOnInsert: { b: 2 } }, { a: 1 }],
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
  ],
};

describe('Mongo update operators', () => {
  Object.entries(GoodTestCases).forEach(([name, cases]) => {
    it(name, () => {
      cases.forEach(([input, op, output]) => {
        const cloned = { ...input };
        applyUpdateQuery([cloned], op as MongooseQueryUpdate);
        expect(cloned).toMatchObject(output);
      });
    });
  });
  it('can build upserted document', () => {
    buildUpsertedDocument({}, {});
  });
});
