import { Mongoose, Schema } from 'mongoose';
import Redis from 'ioredis';
import Mondis from '../mondis';

function attachSampleModels(mongoose: Mongoose) {
  const Vehicle = mongoose.model('Vehicle', new Schema({
    name: String,
    kind: String,
    price: Number,
  }));
  return {
    Vehicle,
  };
}

describe('CachedQuery tests', () => {
  let mongoose: Mongoose;
  let redis: Redis;
  let mondis: Mondis;
  let models: ReturnType<typeof attachSampleModels>;

  beforeEach(async () => {
    mongoose = new Mongoose();
    redis = new Redis(6379, 'localhost');
    mondis = new Mondis({ redis, mongoose });
    mongoose.plugin(mondis.plugin());
    models = attachSampleModels(mongoose);
    await mongoose.connect('mongodb://localhost/testing');
    await Promise.all([
      mongoose.connection.db.dropDatabase(),
      redis.flushall(),
    ]);
  });

  afterEach(() => {
    mongoose.disconnect();
    redis.disconnect();
    jest.resetModules();
  });

  // async function expectRedisSnapshot() {
  //   const keys = await redis.keys('*');
  //   expect(keys).toMatchSnapshot();
  // }

  it('Examples', async () => {
    const { Vehicle } = models;
    await Vehicle.insertMany([
      { name: 'Frank', kind: 'car', price: 2800 },
      { name: 'Henry', kind: 'truck', price: 3300 },
      { name: 'Oliver', kind: 'car', price: 7400 },
      { name: 'Gary', kind: 'plane', price: 312000 },
      { name: 'John', kind: 'truck', price: 9600 },
      { name: 'Wilson', kind: 'bike', price: 220 },
    ]);

    // Static query
    const AllCars = mondis.CachedQuery({
      model: 'Vehicle',
      query: { kind: 'car' },
    });
    // Dynamic query
    const VehiclesByKind = mondis.CachedQuery({
      model: 'Vehicle',
      query: (kind: string) => ({ kind }),
    });
    // Complex query
    const VehiclesUnderPrice = mondis.CachedQuery({
      model: 'Vehicle',
      query: (price: number) => ({
        price: { $lt: price },
      }),
    });

    async function execAll() {
      return Promise.all([
        AllCars.exec(),
        VehiclesByKind.exec(['truck']),
        VehiclesUnderPrice.exec([8000]),
      ]);
    }

    await execAll();
    await execAll();
    await Vehicle.deleteOne({ kind: 'car' });
    await Vehicle.create({ name: 'Roy', kind: 'car', price: 5500 });
    await execAll();
    await Vehicle.create({ name: 'Bob', kind: 'truck', price: 1200 });
    await execAll();
  });
});
