import { Mongoose, Schema, Types } from 'mongoose';
import Redis from 'ioredis';
import type CachedQuery from 'src/CachedQuery';
import type { CachedQueryConfig } from 'src/CachedQuery';
import type { HasObjectId } from 'src/CachedQuery/types';
import Mondis from '../mondis';

const DriverSchema = new Schema({
  name: String,
});

const VehicleSchema = new Schema({
  kind: String,
  price: Number,
  driver: {
    type: Schema.Types.ObjectId,
    ref: 'Driver',
  },
});

async function prepareDatabase(mongoose: Mongoose) {
  const Vehicle = mongoose.model('Vehicle', VehicleSchema);
  const Driver = mongoose.model('Driver', DriverSchema);
  const drivers = await Driver.insertMany([
    { name: 'Henry' },
    { name: 'John' },
    { name: 'Jane' },
    { name: 'Mary' },
  ]);
  await Vehicle.insertMany([
    { kind: 'bike', driver: drivers[0]?._id, price: 510 },
    { kind: 'car', driver: drivers[1]?._id, price: 3100 },
    { kind: 'car', driver: drivers[2]?._id, price: 11900 },
    { kind: 'car', driver: drivers[3]?._id, price: 6500 },
    { kind: 'truck', driver: drivers[0]?._id, price: 5100 },
    { kind: 'truck', price: 7800 },
    { kind: 'truck', driver: drivers[2]?._id, price: 14200 },
    { kind: 'plane', driver: drivers[1]?._id, price: 88000 },
    { kind: 'plane', driver: drivers[3]?._id, price: 125000 },
  ]);
  return {
    Vehicle,
    Driver,
  };
}

describe('CachedQuery tests', () => {
  let mongoose: Mongoose;
  let redis: Redis;
  let mondis: Mondis;
  let models: Awaited<ReturnType<typeof prepareDatabase>>;

  beforeEach(async () => {
    mongoose = new Mongoose();
    redis = new Redis(6379, 'localhost');
    mondis = new Mondis({ redis, mongoose });
    mongoose.plugin(mondis.plugin());
    await mongoose.connect('mongodb://localhost/testing');
    await Promise.all([
      mongoose.connection.db.dropDatabase(),
      redis.flushall(),
    ]);
    models = await prepareDatabase(mongoose);
  });

  afterEach(() => {
    mongoose.disconnect();
    redis.disconnect();
    jest.resetModules();
  });

  async function testWith(cq: CachedQuery, params: unknown[]) {
    const { Vehicle } = models;
    await cq.exec(params);
    await cq.exec({ params });
    await Vehicle.deleteOne({ kind: 'car' });
    await Vehicle.create({ kind: 'plane', price: 221000 });
    await cq.execWithCount({ params });
    await Vehicle.create({ kind: 'truck', price: 1800 });
    await cq.execWithCount({ params });
    await cq.exec({ params, skip: 1 });
    await Vehicle.updateMany({ kind: 'truck' }, { $inc: { price: 2000 } });
    await cq.exec({ params, skip: 2, limit: 1 });
    await Vehicle.updateOne({ kind: 'car' }, { $inc: { price: 2000 } });
    await cq.execOne({ params });
    await Vehicle.updateOne(
      { kind: 'unicycle' },
      { $setOnInsert: { price: 400 } },
      { upsert: true },
    );
    await cq.exec({ params, limit: 1 });
    const vehicle = new Vehicle({ kind: 'car' });
    await vehicle.save();
    await cq.exec({ params, skipCache: true });
    await cq.exec({ params });
    vehicle.price = 24000;
    await vehicle.save();
    await cq.exec({ params });
    await vehicle.remove();
    await cq.exec({ params });
  }

  function doTests<P extends unknown[] = never>(
    name: string,
    conf: Omit<CachedQueryConfig<HasObjectId, P>, 'model'>,
    params: unknown[],
  ) {
    [1, Infinity].forEach((cacheCount) => {
      [[], [{ path: 'driver', ref: 'Driver' }]].forEach((populate) => {
        it(`${name}: cacheCount=${cacheCount}, populate=${populate.length}`, async () => {
          const BuiltQuery = mondis.CachedQuery({
            ...conf,
            // cacheCount,
            // populate,
            model: 'Vehicle',
          } as unknown as CachedQueryConfig<HasObjectId, unknown[]>);
          await testWith(BuiltQuery, params);
        });
      });
    });
  }

  doTests('Static query', {
    query: { kind: 'car' },
  }, []);

  doTests('Static query with operator', {
    query: { price: { $lt: 10000 } },
  }, []);

  doTests('Dynamic query', {
    query: (kind: string) => ({ kind }),
  }, ['car']);

  doTests('Dynamic query with statics', {
    query: (kind: string) => ({ kind, price: { $gt: 5000 } }),
  }, ['truck']);

  doTests('Unique query', {
    query: (_id: Types.ObjectId) => ({ _id }),
    unique: true,
  }, [new Types.ObjectId()]);

  doTests('Complex query', {
    query: (minPrice: number) => ({ price: { $gte: minPrice } }),
  }, [6000]);

  // doTests('Targeted query', {
  //   query: (_ids: Types.ObjectId[]) => ({ _id: { $in: _ids } }),
  //   invalidateOnInsert: false,
  // }, []);
});
