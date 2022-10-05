import type { Model, Types } from 'mongoose';

type VehicleDocument = {
  kind: 'car' | 'truck' | 'bus';
  driver?: Types.ObjectId | null;
  price: number;
};

type DriverDocument = {
  name: string;
  salary: number;
};

type ModelMap = {
  Vehicle: Model<VehicleDocument>,
  Driver: Model<DriverDocument>,
};

type UpdateMap = Record<string, ((map: ModelMap) => Promise<unknown>)>;

const Database = {
  Drivers: [
    { tag: 'D1', name: 'Henry', salary: 55000 },
    { tag: 'D2', name: 'John', salary: 61000 },
    { tag: 'D3', name: 'Jane', salary: 52000 },
    { tag: 'D4', name: 'Mary', salary: 72000 },
  ],
  Vehicles: [
    { tag: 'C1', kind: 'car', price: 1000, routes: ['A', 'B'] },
    { tag: 'C2', kind: 'car', driver: 0, price: 2000, routes: ['A', 'C'] },
    { tag: 'C3', kind: 'car', driver: 1, price: 3000, routes: ['B'] },
    { tag: 'C4', kind: 'car', driver: 2, price: 4000, routes: ['B', 'C'] },
    { tag: 'T1', kind: 'truck', price: 2000, routes: [] },
    { tag: 'T2', kind: 'truck', driver: 0, price: 4000, routes: ['A', 'D'] },
    { tag: 'T3', kind: 'truck', driver: 1, price: 8000, routes: ['C'] },
    { tag: 'T4', kind: 'truck', driver: 2, price: 10000, routes: ['A', 'B', 'C'] },
    { tag: 'B1', kind: 'bus', price: 20000, routes: [] },
    { tag: 'B2', kind: 'bus', price: 40000, routes: ['A'] },
    { tag: 'B3', kind: 'bus', driver: 3, price: 60000, routes: ['D'] },
  ],
};

const Updates: UpdateMap = {
  InsertCar: ({ Vehicle }) => (
    Vehicle.create({ tag: 'C5', kind: 'car', price: 6000, routes: [] })
  ),
  InsertCarWithDriver: ({ Vehicle }) => (
    Vehicle.create({ tag: 'C6', kind: 'car', driver: 0, price: 8000, routes: ['C'] })
  ),
  InsertDriver: ({ Driver }) => (
    Driver.create({ tag: 'D5', name: 'Frank', salary: 51000 })
  ),

  UpdateCarPrice: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'car' }, { $inc: { price: 8000 } }).exec()
  ),
  UpdateAllPrices: ({ Vehicle }) => (
    Vehicle.updateMany({}, { $inc: { price: 2000 } }).exec()
  ),
  UpdateCarDriver: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'car', driver: 0 }, { driver: 1 }).exec()
  ),
  UpdateTruckToBus: ({ Vehicle }) => (
    Vehicle.updateOne({ kind: 'truck' }, { kind: 'bus' }).exec()
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

const Queries = {

  Static1: { // all cars
    query: { kind: 'car' },
    select: { tag: 1 },
  },

  Static2: { // expensive vehicles, with price
    query: { price: { $gte: 8000 } },
    select: { tag: 1, price: 1 },
  },

  Static3: { // vehicles on route A
    query: { routes: 'A' },
    select: { tag: 1 },
  },

  Dynamic1: { // vehicles by kind, with price
    query: (kind: string) => ({ kind }),
    select: { tag: 1, price: 1 },
  },

  Dynamic2: { // vehicles by driver, with routes
    query: (driver: Types.ObjectId) => ({ driver }),
    select: { tag: 1, routes: 1 },
  },

  Complex1: { // vehicles of kinds, with kind
    query: (kinds: string[]) => ({ kind: { $in: kinds } }),
    select: { tag: 1, kind: 1 },
  },

  Complex2: { // vehicles over price, with price
    query: (minPrice: number) => ({ price: { $gte: minPrice } }),
    select: { tag: 1, price: 1 },
  },

  Unique1: { // vehicle by id, without driver
    query: (_id: Types.ObjectId) => ({ _id }),
    unique: true,
  },
};

const Combinations = {
  WithoutDriver: (config) => config,
  WithDriver: (config) => ({
    ...config,
    select: { ...config.select, driver: 1 },
  }),
  WithDriverPopulated: (config) => ({
    ...config,
    populate: { driver: { model: 'Driver' } },
  }),
};

async function runTest(cachedQuery, execUpdate) {
}

function defineTests() {
  Object.entries(Combinations).forEach(([comboName, alterConfig]) => {
    Object.entries(Queries).forEach(([queryName, queryConfig]) => {
      const config = alterConfig(queryConfig);
      Object.entries(Updates).forEach(([updateName, execUpdate]) => {
      });
  });
}

defineTests();