import type { CollectedInvalidations } from '../src/CachedQuery/invalidation/core';
import { mondisTest, MongooseUpdates } from './setup';

Object.entries(MongooseUpdates).forEach(([name, execUpdate]) => {
  mondisTest(name, async ({ mondis, models }) => {
    jest.spyOn(mondis.invalidator, 'doInvalidations').mockImplementation(
      (collected: CollectedInvalidations) => {
        console.error(collected);
        return Promise.resolve();
      },
    );
    await execUpdate(models);
  });
});
