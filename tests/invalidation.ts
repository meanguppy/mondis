import type { CollectedInvalidations } from '../src/CachedQuery/invalidation/core';
import { mondisTest, oid, type ModelMap } from './setup';

type UpdateMap = Record<string, ((map: ModelMap) => Promise<unknown>)>;

const MongooseUpdates: UpdateMap = {
  InsertCar: ({ Vehicle }) => (
    Vehicle.create({ _id: oid('A5'), kind: 'car', price: 6000, routes: [] })
  ),
  InsertTruckWithDriver: ({ Vehicle }) => (
    Vehicle.create({ _id: oid('B5'), kind: 'truck', driver: oid('D2'), price: 10000, routes: ['C'] })
  ),
  InsertDriver: ({ Driver }) => (
    Driver.create({ _id: oid('D5'), name: 'Frank', salary: 51000 })
  ),

  UpdateCarPrice: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'car' }, { $inc: { price: 8000 } }).exec()
  ),
  UpdateAllPrices: ({ Vehicle }) => (
    Vehicle.updateMany({}, { $inc: { price: 2000 } }).exec()
  ),
  UpdateCarDriver: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'car', driver: oid('D1') }, { driver: oid('D2') }).exec()
  ),
  UpdateCarToBus: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'car' }, { kind: 'bus' }).exec()
  ),
  UpdateHenrySalary: ({ Driver }) => (
    Driver.updateOne({ name: 'Henry' }, { salary: 60000 }).exec()
  ),
  UpdateJohnName: ({ Driver }) => (
    Driver.updateOne({ name: 'John' }, { name: 'Jon' }).exec()
  ),
  UpdateBusRoutes: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'bus' }, { $push: { routes: 'B' } }).exec()
  ),
  UpsertCarViaPrice: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'car', price: 11000 }, { price: 15000 }, { upsert: true }).exec()
  ),

  RemoveCar: ({ Vehicle }) => (
    Vehicle.deleteOne({ kind: 'car' }).exec()
  ),
  RemoveTruck: ({ Vehicle }) => (
    Vehicle.deleteOne({ kind: 'truck' }).exec()
  ),
  RemoveHenry: ({ Driver }) => (
    Driver.deleteOne({ name: 'Henry' }).exec()
  ),
};

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
