import mongoose, { Schema, Types } from 'mongoose';
import Redis from 'ioredis';
import Mondis from './mondis';

const redis = new Redis(6379, '127.0.0.1');
const mondis = new Mondis({ redis, mongoose });
mongoose.plugin(mondis.plugin());

type HelloDocument = {
  _id: Types.ObjectId;
  name: string;
  kind: string;
  price: number;
};
const HelloSchema = new Schema<HelloDocument>({
  name: String,
  kind: String,
  price: Number,
});

type WorldDocument = {
  _id: Types.ObjectId;
  name: string;
};
const WorldSchema = new Schema<WorldDocument>({
  name: String,
});

const Hello = mongoose.model('Hello', HelloSchema);
const World = mongoose.model('World', WorldSchema);

async function seed() {
  await Promise.all([
    mongoose.connect('mongodb://localhost/cq-dev'),
    Hello.deleteMany({}),
    World.deleteMany({}),
  ]);
  await World.insertMany([
    { name: 'one' },
    { name: 'two' },
    { name: 'three' },
    { name: 'four' },
  ]);
  await Hello.insertMany([
    { name: 'frank', kind: 'car', price: 4500 },
    { name: 'henry', kind: 'truck', price: 2000 },
    { name: 'oliver', kind: 'plane', price: 88000 },
    { name: 'gary', kind: 'plane', price: 321000 },
    { name: 'franklin', kind: 'truck', price: 7200 },
    { name: 'john', kind: 'car', price: 3900 },
  ]);
}

const VehicleByKind = mondis.CachedQuery<HelloDocument, [string]>({
  model: 'Hello',
  query: (kind) => ({ kind }),
});

const CheapVehicles = mondis.CachedQuery<HelloDocument>({
  model: 'Hello',
  query: {
    price: { $lt: 6000 },
  },
});

async function main() {
  await seed();
  console.log(
    await CheapVehicles.exec(),
    await VehicleByKind.exec(['car']),
  );
  await Hello.create({
    name: 'rich',
    kind: 'car',
    price: 8000,
  });
}

main().then(() => setTimeout(() => {
  process.exit(0);
}, 1000));
