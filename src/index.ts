import type { Redis, ClientContext } from 'ioredis';
import type { Mongoose } from 'mongoose';

class Mondis {
  private _clients?: { redis: Redis, mongoose: Mongoose };

  init(redis: Redis, mongoose: Mongoose) {
    /**
     * Expire-Greater:
     *   Sets a key's expiry to either the provided TTL or the current one, whichever is greater.
     */
    redis.defineCommand('expiregt', {
      numberOfKeys: 1,
      lua: `
        local newTTL = tonumber(ARGV[1])
        local curTTL = redis.call("TTL", KEYS[1])
        if newTTL > curTTL then
          return redis.call("EXPIRE", KEYS[1], newTTL)
        end
      `,
    });

    /**
     * Delete-Query:
     *   Delete a cached query and clean up other keys used for invalidation tracking.
     */
    redis.defineCommand('delquery', {
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
    });

    this._clients = {
      redis,
      mongoose,
    };
  }

  get clients() {
    if (!this._clients) {
      throw Error('Backing clients have not yet been set with init(redis, mongoose)');
    }
    return this._clients;
  }
}

export default Mondis;
