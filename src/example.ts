import mongoose, { Schema, Types } from 'mongoose';
import Redis from 'ioredis';
import Mondis from './mondis';
import { parseConfig as define } from './CachedQuery/config';

const queries = {
  NamesAndKinds: define<HelloDocument>({
    model: 'Hello',
    query: {},
    select: { name: 1, kind: 1 },
  }),
  KindSortedByPrice: define<HelloDocument, [string]>({
    model: 'Hello',
    query: (kind) => ({ kind }),
    select: { name: 1 },
    populate: { driver: { model: 'World' } },
    sort: { price: 1 },
  }),
  KindsSortedByPrice: define<HelloDocument, [string[]]>({
    model: 'Hello',
    query: (kinds) => ({ kind: { $in: kinds } }),
    select: { name: 1, kind: 1 },
    sort: { price: 1 },
  }),
  AllCars: define<HelloDocument>({
    model: 'Hello',
    query: { kind: 'car' },
    select: { name: 1, kind: 1 },
  }),
};

const redis = new Redis(6379, '127.0.0.1');
const mondis = new Mondis({ redis, mongoose, queries });
const {
  NamesAndKinds,
  KindSortedByPrice,
  // KindsSortedByPrice,
  // AllCars,
} = mondis.queries;
// TODO: should the plugin be attached automatically upon init?
mongoose.plugin(mondis.plugin());

type HelloDocument = {
  _id: Types.ObjectId;
  name: string;
  kind: string;
  price: number;
  driver: Types.ObjectId;
};
const HelloSchema = new Schema<HelloDocument>({
  name: String,
  kind: String,
  price: Number,
  driver: {
    ref: 'World',
    type: Schema.Types.ObjectId,
  },
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
    // redis.flushall(),
    Hello.deleteMany({}),
    World.deleteMany({}),
  ]);
  const d = await World.insertMany([
    { name: 'one' },
    { name: 'two' },
    { name: 'three' },
    { name: 'four' },
  ]);
  await Hello.insertMany([
    { name: 'frank', kind: 'car', price: 4500, driver: d[0]!._id },
    { name: 'henry', kind: 'truck', price: 2000 },
    { name: 'oliver', kind: 'plane', price: 88000 },
    { name: 'gary', kind: 'plane', price: 321000 },
    { name: 'franklin', kind: 'truck', price: 7200 },
    { name: 'john', kind: 'car', price: 3900 },
  ]);
}

async function main() {
  console.log(KindSortedByPrice);
  await mongoose.connect('mongodb://localhost/cq-dev');
  await seed();
  console.log(await KindSortedByPrice.exec(['car']));
  await KindSortedByPrice.exec(['truck']);
  await NamesAndKinds.exec();
  await Hello.updateOne({ kind: 'car' }, { name: 'dude' });
}

main().then(() => setTimeout(() => {
  process.exit(0);
}, 1000));
