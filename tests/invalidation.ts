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
