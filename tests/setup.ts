import sharedMongoose, { Schema } from 'mongoose';
import type { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { deserialize } from 'bson';
import { defineCQ, type InputConfig } from '../src/CachedQuery/config';
import Mondis from '../src/mondis';

export type VehicleDocument = {
  _id: Types.ObjectId;
  kind: 'car' | 'truck' | 'bus';
  driver?: Types.ObjectId | undefined;
  price: number;
  routes: string[];
};

export type DriverDocument = {
  _id: Types.ObjectId;
  name: string;
  salary: number;
};

export type ModelMap = {
  Vehicle: Model<VehicleDocument>,
  Driver: Model<DriverDocument>,
};

export function oid(byte: string) {
  return new sharedMongoose.Types.ObjectId(
    `0000000000000000000000${byte}`,
  );
}

export const Drivers = [
  { _id: oid('D1'), name: 'Henry', salary: 55000 },
  { _id: oid('D2'), name: 'John', salary: 61000 },
  { _id: oid('D3'), name: 'Jane', salary: 52000 },
  { _id: oid('D4'), name: 'Mary', salary: 72000 },
] as const;

export const Vehicles = [
  { _id: oid('A1'), kind: 'car', price: 1000, routes: ['A', 'B'] },
  { _id: oid('A2'), kind: 'car', driver: Drivers[0]._id, price: 2000, routes: ['A', 'C'] },
  { _id: oid('A3'), kind: 'car', driver: Drivers[1]._id, price: 3000, routes: ['B'] },
  { _id: oid('A4'), kind: 'car', driver: Drivers[2]._id, price: 4000, routes: ['B', 'C'] },
  { _id: oid('B1'), kind: 'truck', price: 2000, routes: [] },
  { _id: oid('B2'), kind: 'truck', driver: Drivers[0]._id, price: 4000, routes: ['A', 'D'] },
  { _id: oid('B3'), kind: 'truck', driver: Drivers[1]._id, price: 8000, routes: ['C'] },
  { _id: oid('B4'), kind: 'truck', driver: Drivers[2]._id, price: 10000, routes: ['A', 'B', 'C'] },
  { _id: oid('C1'), kind: 'bus', price: 20000, routes: [] },
  { _id: oid('C2'), kind: 'bus', price: 40000, routes: ['A'] },
  { _id: oid('C3'), kind: 'bus', driver: Drivers[3]._id, price: 60000, routes: ['D'] },
] as const;

export type MondisTestInstance = Awaited<ReturnType<typeof init>>['mondis'];

export async function init(extraConfig: Partial<InputConfig>) {
  const queries = {
  /* All cars */
    Static1: defineCQ<VehicleDocument>({
      ...extraConfig,
      model: 'Vehicle',
      query: { kind: 'car' },
      select: { _id: 1 },
    }),
    /* Expensive vehicles, with price */
    Static2: defineCQ<VehicleDocument>({
      ...extraConfig,
      model: 'Vehicle',
      query: { price: { $gte: 8000 } },
      select: { _id: 1, price: 1 },
    }),
    /* Vehicles by kind, with price */
    Dynamic1: defineCQ<VehicleDocument, [string]>({
      ...extraConfig,
      model: 'Vehicle',
      query: (kind) => ({ kind }),
      select: { _id: 1, price: 1 },
    }),
    /* Vehicles by route, with routes */
    Dynamic2: defineCQ<VehicleDocument, [string]>({
      ...extraConfig,
      model: 'Vehicle',
      query: (route) => ({ routes: route }),
      select: { _id: 1, routes: 1 },
    }),
    /* Vehicles by driver, that have no routes, with driver and kind */
    Dynamic3: defineCQ<VehicleDocument, [Types.ObjectId]>({
      ...extraConfig,
      model: 'Vehicle',
      query: (driver) => ({ driver, routes: { $size: 0 } }),
      select: { _id: 1, driver: 1, kind: 1 },
    }),
    /* Vehicles of kinds, with kind */
    Complex1: defineCQ<VehicleDocument, [string[]]>({
      ...extraConfig,
      model: 'Vehicle',
      query: (kinds) => ({ kind: { $in: kinds } }),
      select: { _id: 1, kind: 1 },
    }),
    /* Vehicles over price, with price */
    Complex2: defineCQ<VehicleDocument, [number]>({
      ...extraConfig,
      model: 'Vehicle',
      query: (minPrice) => ({ price: { $gte: minPrice } }),
      select: { _id: 1, price: 1 },
    }),
    /* Vehicle by id, without driver */
    Unique1: defineCQ<VehicleDocument, [Types.ObjectId]>({
      ...extraConfig,
      model: 'Vehicle',
      query: (_id) => ({ _id }),
      unique: true,
    }),
    /* All vehicles, with full driver */
    Populated1: defineCQ<VehicleDocument>({
      ...extraConfig,
      model: 'Vehicle',
      query: {},
      select: { _id: 1 },
      populate: { driver: { model: 'Driver' } },
    }),
    /* All vehicles, with driver name only */
    Populated2: defineCQ<VehicleDocument>({
      ...extraConfig,
      model: 'Vehicle',
      query: {},
      select: { _id: 1 },
      populate: { driver: { model: 'Driver', select: { name: 1 } } },
    }),
    /* Expensive vehicles, sorted by price, without price */
    Sorted1: defineCQ<VehicleDocument>({
      ...extraConfig,
      model: 'Vehicle',
      query: { price: { $gte: 8000 } },
      select: { _id: 1 },
      sort: { price: 1 },
    }),
    /* Complex query without insert invalidations, without driver */
    Targeted1: defineCQ<VehicleDocument, [Types.ObjectId[]]>({
      ...extraConfig,
      model: 'Vehicle',
      query: (ids) => ({ _id: { $in: ids } }),
      select: { driver: 0 },
      invalidateOnInsert: false,
    }),
  } as const;

  const redis = new Redis.Cluster([{ host: '127.0.0.1', port: 30001 }]);
  const mongoose = new sharedMongoose.Mongoose();
  const mondis = new Mondis({ redis, mongoose, queries });

  const Vehicle = mongoose.model('Vehicle', new Schema<VehicleDocument>({
    kind: { type: String },
    driver: { type: Schema.Types.ObjectId, ref: 'Driver' },
    price: { type: Number },
    routes: [{ type: String }],
  }));
  const Driver = mongoose.model('Driver', new Schema<DriverDocument>({
    name: { type: String },
    salary: { type: Number },
  }));

  const hashMocks: jest.SpyInstance[] = [];
  Object.entries(mondis.queries).forEach(([name, cachedQuery]) => {
    const fakeHash = `${name}${'_'.repeat(24)}`.substring(0, 16);
    hashMocks.push(jest.spyOn(cachedQuery, 'hash', 'get').mockReturnValue(fakeHash));
  });

  async function execAll(opts: { skip?: number, limit?: number, skipCache?: boolean }) {
    const { queries: q } = mondis;
    await Promise.all([
      q.Static1.execWithCount({ ...opts }),
      q.Static2.execWithCount({ ...opts }),
      q.Dynamic1.execWithCount({ ...opts, params: ['truck'] }),
      q.Dynamic2.execWithCount({ ...opts, params: ['A'] }),
      q.Dynamic3.execWithCount({ ...opts, params: [oid('D2')] }),
      q.Complex1.execWithCount({ ...opts, params: [['car', 'bus']] }),
      q.Complex2.execWithCount({ ...opts, params: [5000] }),
      q.Unique1.execOne([oid('A4')]),
      q.Populated1.execWithCount({ ...opts }),
      q.Populated2.execWithCount({ ...opts }),
      q.Sorted1.execWithCount({ ...opts }),
      q.Targeted1.execWithCount({ ...opts, params: [[oid('B1'), oid('B2')]] }),
    ]);
  }

  async function expectRedisSnapshot(keyPattern = '*', withValues = true) {
    const promises = await Promise.all(
      redis.nodes('master').map((node) => node.keys(keyPattern)),
    );
    const keys = promises.flat().sort((a, b) => (a > b ? 1 : -1));
    if (withValues) {
      const entries = await Promise.all(keys.map(async (key) => {
        let value: unknown;
        if (key.startsWith('Q:')) {
          const data = await redis.hgetBuffer(key, 'V');
          const count = await redis.hget(key, 'N');
          value = {
            count: count ? parseInt(count, 10) : null,
            data: data ? Object.values(deserialize(data)) : null,
          };
        } else {
          value = await redis.smembers(key);
        }
        return [key, value];
      }));
      expect(Object.fromEntries(entries)).toMatchSnapshot(`Redis content ${keyPattern}`);
    } else {
      expect(keys).toMatchSnapshot(`Redis keys ${keyPattern}`);
    }
  }

  async function setupData() {
    await Promise.all([
      mongoose.connect('mongodb://localhost/testing'),
      new Promise((res) => { redis.on('ready', res); }),
    ]);
    await Promise.all([
      mongoose.connection.db.dropDatabase(),
      ...redis.nodes('master').map((node) => node.flushall()),
    ]);
    await Promise.all([
      Vehicle.insertMany(Vehicles),
      Driver.insertMany(Drivers),
    ]);
  }

  await setupData();

  return {
    mondis,
    models: { Vehicle, Driver },
    mongoose,
    redis,
    execAll,
    expectRedisSnapshot,
    hashMocks,
  } as const;
}

export function mondisTest(
  name: string,
  handler: (context: Awaited<ReturnType<typeof init>>) => unknown,
  extraConfig: Partial<InputConfig> = {},
) {
  it(name, async () => {
    const context = await init(extraConfig);
    await handler(context);
    const { redis, mongoose } = context;
    await Promise.all([mongoose.disconnect(), redis.disconnect()]);
  });
}
