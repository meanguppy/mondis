import type Redis from 'ioredis';
import type { Result, Callback } from 'ioredis';
import type { Mongoose } from 'mongoose';
import type { CacheEffect } from './CachedQuery/types';
import bindPlugin from './CachedQuery/mongoosePlugin';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    expiregt(
      key: string,
      ttl: number,
      callback?: Callback<string>
    ): Result<string, Context>;
    delquery(
      queryKey: string,
      callback?: Callback<string>
    ): Result<string, Context>;
  }
}

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
  /**
   * Delete-Query:
   *   Delete a cached query and clean up other keys used for invalidation tracking.
   */
  delquery: {
    numberOfKeys: 1,
    lua: `
      local qkey = KEYS[1]
      local depends = redis.call("HGET", qkey, "depends")
      if depends == nil then
        return 0 end
      local allKey = "all:"..string.sub(qkey, 3, 18)
      redis.call("SREM", allKey, qkey)
      redis.call("DEL", qkey)
      for key in string.gmatch(depends, "%S+") do
        redis.call("SREM", "obj:"..key, qkey)
      end
      return 1
    `,
  },
};

type MondisConfiguration = {
  redis?: Redis;
  mongoose?: Mongoose;
};

class Mondis {
  private _redis?: Redis;

  private _mongoose?: Mongoose;

  constructor(config?: MondisConfiguration) {
    this.init(config ?? {});
  }

  init(config: MondisConfiguration) {
    const { redis, mongoose } = config;
    if (redis) {
      Object.entries(commands).forEach(([name, conf]) => {
        redis.defineCommand(name, conf);
      });
      this._redis = redis;
    }
    if (mongoose) this._mongoose = mongoose;
  }

  notifyEffect(effect: CacheEffect) {
    console.log('GOT EFFECT', effect);
  }

  plugin() {
    return bindPlugin(this);
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
