import type { CollectedInvalidations } from '../src/CachedQuery/invalidation/core';
import { mondisTest, MongooseUpdates } from './setup';

Object.entries(MongooseUpdates).forEach(([name, execUpdate]) => {
  mondisTest(name, async ({ mondis, models }) => {
    jest.spyOn(mondis.invalidator, 'doInvalidations').mockImplementation((collected: CollectedInvalidations) => {
      collected.keys?.sort((a, b) => (a > b ? 1 : -1));
      collected.sets?.sort((a, b) => (a > b ? 1 : -1));
      expect(collected).toMatchSnapshot();
      return Promise.resolve();
    });
    await execUpdate(models);
  });
});

// TODO: test to ensure keys are actually invalidated.

// TODO: utils unit tests
// testCase({ inclusive: false, paths: [] }, [], false);
// testCase({ inclusive: false, paths: [] }, ['lol'], true);
// testCase({ inclusive: true, paths: ['hello'] }, ['hello.world'], true);
// testCase({ inclusive: true, paths: ['hello.world'] }, ['hello.world'], true);
// testCase({ inclusive: true, paths: ['hello.world'] }, ['hello.lol'], false);
// testCase({ inclusive: true, paths: ['hello.world'] }, ['hello'], true);
// testCase({ inclusive: true, paths: ['hello', 'lol'] }, ['lol'], true);
// testCase({ inclusive: true, paths: ['hello', 'lol'] }, ['nah'], false);
// testCase({ inclusive: false, paths: ['hello'] }, ['hello.world'], false);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello.world'], false);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello.lol'], true);
// testCase({ inclusive: false, paths: ['hello', 'lol'] }, ['hello', 'lol'], false);
// testCase({ inclusive: false, paths: ['hello', 'lol'] }, ['hello', 'lol', 'cool'], true);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello'], true);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello.world.ok'], false);
