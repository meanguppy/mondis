import type { Redis, Cluster } from 'ioredis';
import type { Mongoose } from 'mongoose';
import type { CachedQueryConfig } from './CachedQuery/config';
import CachedQuery from './CachedQuery';
import InvalidationHandler from './CachedQuery/invalidation/handler';
import RehydrationHandler from './CachedQuery/rehydration/handler';
import bindPlugin from './CachedQuery/invalidation/mongoose-plugin';

type MondisConfiguration<Q> = {
  redis?: Redis | Cluster;
  mongoose?: Mongoose;
  queries?: Q;
};

type CachedQueryMap<Q> = Record<string, CachedQuery> & {
  [K in keyof Q]: Q[K] extends CachedQueryConfig<infer T, infer P>
    ? CachedQuery<T, P>
    : never;
};

function buildCachedQueryMap<Q>(mondis: Mondis, input: unknown) {
  if (!input) return {} as CachedQueryMap<Q>;
  if (typeof input !== 'object') throw Error('Invalid `queries` object');
  const constructed = Object.entries(input).map(([name, val]) => {
    if (!val) throw Error('Invalid CachedQueryConfig'); // TODO: use instanceof
    return [name, new CachedQuery(mondis, val as CachedQueryConfig)];
  });
  return Object.fromEntries(constructed) as CachedQueryMap<Q>;
}

class Mondis<Q = {}> {
  private _redis?: Redis | Cluster;
  private _mongoose?: Mongoose;
  readonly invalidator: InvalidationHandler;
  readonly rehydrator: RehydrationHandler;
  readonly queries: CachedQueryMap<Q>;

  constructor(config: MondisConfiguration<Q> = {}) {
    this.queries = buildCachedQueryMap(this, config.queries);
    this.invalidator = new InvalidationHandler(this);
    this.rehydrator = new RehydrationHandler(this);
    this.init(config);
  }

  init(clients: { redis?: Redis | Cluster, mongoose?: Mongoose }) {
    const { redis, mongoose } = clients;
    if (redis) {
      this._redis = redis;
    }
    if (mongoose) {
      const modelCount = Object.keys(mongoose.models).length;
      if (modelCount > 0) {
        // TODO: allow manual override with schema config?
        throw Error(
          'The Mongoose instance provided already contains registered models. '
          + 'Ensure mondis is constructed before registering any schemas.',
        );
      }
      mongoose.plugin(bindPlugin(this.invalidator));
      this._mongoose = mongoose;
    }
  }

  async rehydrate(keys?: string[]) {
    if (keys === undefined) {
      keys = [...this.invalidator.keysInvalidated];
      this.invalidator.keysInvalidated.length = 0;
    }
    return this.rehydrator.rehydrate(keys);
  }

  get redis() {
    if (!this._redis) throw Error('Redis client has not yet been set with init()');
    return this._redis;
  }

  get mongoose() {
    if (!this._mongoose) throw Error('Mongoose client has not yet been set with init()');
    return this._mongoose;
  }
}

export default Mondis;
