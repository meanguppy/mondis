import mongoose, { Schema, Types } from 'mongoose';
import Redis from 'ioredis';
import Mondis from './mondis';
import CachedQuery from './CachedQuery';

const redis = new Redis(6379, '127.0.0.1');
const mondis = new Mondis({ redis, mongoose });
mongoose.plugin(mondis.plugin());

type HelloDocument = {
  _id: Types.ObjectId;
  name: string;
  kind: string;
  date: Date;
  friend: WorldDocument;
  items: Array<{ hello: string, world: string }>;
};
const HelloSchema = new Schema<HelloDocument>({
  name: String,
  kind: String,
  date: {
    type: Date,
    default: new Date(),
  },
  friend: {
    type: Schema.Types.ObjectId,
    ref: 'World',
  },
  items: [
    { _id: false, hello: String, world: String },
  ],
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
    redis.flushall(),
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
    { name: 'frank', kind: 'car' },
    { name: 'henry', kind: 'truck' },
    { name: 'oliver', kind: 'plane' },
    { name: 'gary', kind: 'plane' },
    { name: 'franklin', kind: 'truck' },
    { name: 'john', kind: 'car' },
  ]);
}

const Thingy = new CachedQuery<HelloDocument>(mondis, {
  model: 'Hello',
  query: (kind: string) => ({ kind }),
  populate: [{ path: 'friend' }],
});

async function main() {
  await seed();
  const res1 = await Thingy.exec({ params: ['car'] });
  console.log(res1);
}

main().then(() => process.exit(0));
