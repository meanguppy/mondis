import mongoose, { Schema } from 'mongoose';
import Redis from 'ioredis';
import Mondis from './mondis';
import CachedQuery from './CachedQuery';

const redis = new Redis(6379, '127.0.0.1');
const mondis = new Mondis();
mondis.init(redis, mongoose);

type HelloDocument = {
  name: string;
  kind: string;
};
const HelloSchema = new Schema<HelloDocument>({
  name: String,
  kind: String,
});

type WorldDocument = {};
const WorldSchema = new Schema<WorldDocument>({});

const Hello = mongoose.model('Hello', HelloSchema);
const World = mongoose.model('World', WorldSchema);

async function seed() {
  await Promise.all([
    mongoose.connect('mongodb://localhost/cq-dev'),
    redis.flushall(),
    Hello.deleteMany({}),
    World.deleteMany({}),
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
});

async function main() {
  await seed();

  const res = await Thingy.exec({ params: ['car'] });
  console.log(res);
}

main();
