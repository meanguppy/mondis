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
    Hello.deleteMany({}),
    World.deleteMany({}),
  ]);
  await World.insertMany([
    { name: 'one' },
    { name: 'two' },
    { name: 'three' },
    { name: 'four' },
  ]);
  // TODO: need to solution for insertMany
  await Promise.all(
    [{ name: 'frank', kind: 'car' },
      { name: 'henry', kind: 'truck' },
      { name: 'oliver', kind: 'plane' },
      { name: 'gary', kind: 'plane' },
      { name: 'franklin', kind: 'truck' },
      { name: 'john', kind: 'car' },
    ].map((o) => Hello.create(o)),
  );
}

const Thingy1 = mondis.CachedQuery<HelloDocument, [string]>({
  model: 'Hello',
  query: (kind) => ({ kind }),
  populate: [{ path: 'friend' }],
});

const Thingy2 = mondis.CachedQuery<HelloDocument>({
  model: 'Hello',
  query: { kind: 'car' },
});

async function main() {
  await seed();
  console.log(await Thingy1.exec(['car']));
  await new Promise((res) => {
    setTimeout(res, 1000);
  });
}

main().then(() => process.exit(0));
