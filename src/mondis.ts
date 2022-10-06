import type Redis from 'ioredis';
import type { Result } from 'ioredis';
import type { Mongoose } from 'mongoose';
import type { CachedQueryConfig } from './CachedQuery/config';
import CachedQuery from './CachedQuery';
import InvalidationHandler from './CachedQuery/invalidation/handler';
import bindPlugin from './CachedQuery/invalidation/mongoose-plugin';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    expiregt(key: string, ttl: number): Result<void, Context>;
    delQuery(queryKey: string): Result<string[], Context>;
    delQueriesIn(setKey: string, filterHashes?: string): Result<string[], Context>;
  }
}

type MondisConfiguration<Q> = {
  redis?: Redis;
  mongoose?: Mongoose;
  queries?: Q;
};

type CachedQueryMap<Q> = Record<string, CachedQuery> & {
  [K in keyof Q]: Q[K] extends CachedQueryConfig<infer T, infer P>
    ? CachedQuery<T, P>
    : never;
};

const commands = {
  /**
   * Expire-Greater:
   *   Sets a key's expiry to either the provided TTL or the current one, whichever is greater.
   */
  expiregt: {
    numberOfKeys: 1,
    lua: `
      local newTTL = tonumber(ARGV[1])
      local curTTL = redis.call("TTL", KEYS[1])
      if newTTL > curTTL then
        return redis.call("EXPIRE", KEYS[1], newTTL)
      end
    `,
  },

  delQuery: {
    numberOfKeys: 1,
    lua: `
      local qkey = KEYS[1]
      local docIds = redis.call("HGET", qkey, "O")
      if docIds == false then
        return 0 end
      for key in string.gmatch(docIds, "%S+") do
        redis.call("SREM", "O:"..key, qkey)
      end
      local populatedIds = redis.call("HGET", qkey, "P")
      for key in string.gmatch(populatedIds, "%S+") do
        redis.call("SREM", "P:"..key, qkey)
      end
      local allKey = "A:"..string.sub(qkey, 3, 18)
      redis.call("SREM", allKey, qkey)
      redis.call("DEL", qkey)
      return 1
    `,
  },

  delQueriesIn: {
    numberOfKeys: 1,
    lua: `
      local result = {}
      local filter = ARGV[1] and ("^Q:"..ARGV[1])
      local keys = redis.call("SMEMBERS", KEYS[1])
      for _, qkey in ipairs(keys) do
        if filter == nil or string.find(qkey, filter) ~= nil then
          local docIds = redis.call("HGET", qkey, "O")
          if docIds ~= false then
            for key in string.gmatch(docIds, "%S+") do
              redis.call("SREM", "O:"..key, qkey)
            end
            local populatedIds = redis.call("HGET", qkey, "P")
            for key in string.gmatch(populatedIds, "%S+") do
              redis.call("SREM", "P:"..key, qkey)
            end
            local allKey = "A:"..string.sub(qkey, 3, 18)
            redis.call("SREM", allKey, qkey)
            redis.call("DEL", qkey)
            table.insert(result, qkey)
          end
        end
      end
      return result
    `,
  },
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
  private _redis?: Redis;

  private _mongoose?: Mongoose;

  readonly invalidator: InvalidationHandler;

  readonly queries: CachedQueryMap<Q>;

  constructor(config: MondisConfiguration<Q> = {}) {
    this.init(config);
    this.queries = buildCachedQueryMap(this, config.queries);
    this.invalidator = new InvalidationHandler(this);
  }

  init(clients: { redis?: Redis, mongoose?: Mongoose }) {
    // TODO: add warning if mongoose already contains schemas (before plugin could be attached)
    const { redis, mongoose } = clients;
    if (redis) {
      Object.entries(commands).forEach(([name, conf]) => {
        redis.defineCommand(name, conf);
      });
      this._redis = redis;
    }
    if (mongoose) this._mongoose = mongoose;
  }

  plugin() {
    return bindPlugin(this.invalidator);
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
