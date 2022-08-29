import mongoose, { Schema } from 'mongoose';
import Mondis from './mondis';
import CachedQuery from './CachedQuery';

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

const mondis = new Mondis();
const Thingy = new CachedQuery<HelloDocument>(mondis, {
  model: 'Hello',
  query: { },
});

async function seed() {
  await mongoose.connect('mongodb://localhost/cq-dev');

  await Hello.deleteMany({});
  await World.deleteMany({});

  await Hello.insertMany([
    { name: 'frank', kind: 'car' },
    { name: 'henry', kind: 'truck' },
    { name: 'oliver', kind: 'plane' },
    { name: 'gary', kind: 'plane' },
    { name: 'franklin', kind: 'truck' },
    { name: 'john', kind: 'car' },
  ]);
}

async function main() {
  await seed();

  const res = await Thingy.exec();
  const item = res[0];
  if (!item) return;

  const { name, kind } = item;
  console.log(name, kind);
}

main();
