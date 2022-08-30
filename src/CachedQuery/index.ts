import type { FilterQuery, PopulateOptions, SortOrder } from 'mongoose';
import { serialize, deserialize } from 'bson';
import * as crypto from 'crypto';
import type Mondis from '../mondis';
import { collectPopulatedIds, skipAndLimit } from './lib';

// TODO: consider more strict definition, future features may bar complex selects.
export type MongooseProjection = Record<string, unknown>;

export type MongoosePopulations = Array<{
  [P in keyof PopulateOptions]: P extends 'populate'
    ? MongoosePopulations
    : PopulateOptions[P];
}>;

export type MongooseSortConfig = string | { [key: string]: SortOrder };

type ConfigInput = {
  model: string;
  // TODO: decide if FilterQuery is a good definition for this.
  query: FilterQuery<unknown> | ((...params: unknown[]) => FilterQuery<unknown>);
  select?: MongooseProjection;
  populate?: MongoosePopulations;
  sort?: MongooseSortConfig | null;
  cacheCount?: number;
  unique?: boolean;
  invalidateOnInsert?: boolean;
  expiry?: number;
  rehydrate?: boolean;
};

type Config = Required<ConfigInput>;

type QueryExecOpts<T> = {
  params?: unknown[];
  limit?: number;
  skip?: number;
  filter?: (doc: T) => boolean;
  skipCache?: boolean;
};

type InputExecOpts<T> = unknown[] | QueryExecOpts<T>;

class CachedQuery<T> implements Config {
  context: Mondis;

  private _hash?: string;

  model: string;

  query: FilterQuery<unknown> | ((...params: unknown[]) => FilterQuery<unknown>);

  select: MongooseProjection;

  populate: MongoosePopulations;

  sort: MongooseSortConfig | null;

  cacheCount: number;

  expiry: number;

  unique: boolean;

  invalidateOnInsert: boolean;

  rehydrate: boolean;

  constructor(context: Mondis, config: ConfigInput) {
    this.context = context;
    const {
      model,
      query,
      select = {},
      populate = [],
      sort = null,
      cacheCount = Infinity,
      expiry = 12 * 60 * 60, // 12 hours
      unique = false,
      invalidateOnInsert = true,
      rehydrate = true,
    } = config;
    this.model = model;
    this.query = query;
    this.select = select;
    this.populate = populate;
    this.sort = sort;
    this.cacheCount = cacheCount;
    this.expiry = expiry;
    this.unique = unique;
    this.invalidateOnInsert = invalidateOnInsert;
    this.rehydrate = rehydrate;
  }

  getCacheKey(params: unknown[] = []) {
    const { query, hash } = this;
    const expectNumParams = (typeof query === 'function') ? query.length : 0;
    if (expectNumParams !== params.length) {
      throw Error(`Invalid number of params passed: expected ${expectNumParams}, got ${params.length}`);
    }
    // TODO: use bson for params string?
    const paramsStr = JSON.stringify(params);
    return `q:${hash}${paramsStr}`;
  }

  getCacheKeyForAll() {
    return `all:${this.hash}`;
  }

  private buildQuery(opts?: InputExecOpts<T>) {
    const { mongoose } = this.context;
    const { params = [], skip, limit } = this.parseOpts(opts);
    const {
      model, query, unique, select, sort, populate = [],
    } = this;
    const queryObj = (typeof query === 'object') ? query : query(...params);
    const q = mongoose.model<T>(model).find(queryObj);
    if (unique) {
      q.limit(1);
    } else {
      if (sort) q.sort(sort);
      if (skip) q.skip(skip);
      if (limit && limit !== Infinity) q.limit(limit);
    }
    if (select) q.select(select);
    if (populate.length) q.populate(populate);
    return q;
  }

  async execMongo(opts?: InputExecOpts<T>) {
    const query = this.buildQuery(opts);
    const result = await query.lean().exec();
    return result;
  }

  async countMongo(opts?: InputExecOpts<T>) {
    opts = this.parseOpts(opts);
    const { skip, limit, ...rest } = opts;
    const q = this.buildQuery(rest);
    return q.countDocuments();
  }

  /**
   * Stringifies the result object and stores it in cache.
   */
  private async serializeAndCache(result: T[], cacheKey: string) {
    const { redis } = this.context;
    try {
      const bson = serialize(result);
      const depends = collectPopulatedIds(result, this.populate);
      const allKey = this.getCacheKeyForAll();
      // Cache result, and create keys used for tracking invalidations
      const multi = redis.multi();
      multi.del(cacheKey);
      multi.hset(cacheKey, 'value', bson);
      multi.hset(cacheKey, 'depends', depends.join(' '));
      multi.sadd(allKey, cacheKey);
      multi.expiregt(cacheKey, this.expiry);
      multi.expiregt(allKey, this.expiry);
      depends.forEach((id) => {
        multi.sadd(`obj:${id}`, cacheKey);
        multi.expiregt(`obj:${id}`, this.expiry);
      });
      await multi.exec();
    } catch (err) {
      // logger.warn({ err, tag: 'CACHE_REDIS_SET', cacheKey, result, }, 'Failed to set value');
    }
  }

  async exec(opts?: InputExecOpts<T>): Promise<T[]> {
    const { redis } = this.context;
    opts = this.parseOpts(opts);
    const {
      params = [], skip = 0, limit, skipCache = false, filter,
    } = opts;
    const { cacheCount, unique } = this;

    // query is outside cacheable skip/limit, fall back to mongo query and do not cache.
    // note: filter not handled here because filterable queries require cacheCount=Infinity
    if ((cacheCount < Infinity && limit === undefined) || (limit && (limit + skip) > cacheCount)) {
      return (await this.execMongo(opts)) as T[];
    }
    let result: undefined | T[];
    const cacheKey = this.getCacheKey(params);
    if (!skipCache) {
      try {
        const bson = await redis.hgetBuffer(cacheKey, 'value');
        if (bson !== null) {
          result = Object.values(deserialize(bson)) as T[];
        }
      } catch (err) {
        // logger.warn({ err, tag: 'CACHE_REDIS_GET', cacheKey }, 'Failed to HGET value');
      }
    }
    if (!result) {
      result = await this.execMongo({ params, limit: cacheCount }) as T[];
      /* If a unique query has no results, do not cache the empty array.
       * The matching item could still be inserted at a later time, and because
       * unique queries do not invalidate upon document insert, that event
       * would not be detected for invalidation. */
      if (result.length > 0 || !unique) {
        this.serializeAndCache(result, cacheKey);
      }
    }
    if (filter) result = result.filter(filter);
    return skipAndLimit(result, skip, limit);
  }

  async execOne(opts?: InputExecOpts<T>): Promise<T | null> {
    opts = this.parseOpts(opts);
    const result = await this.exec({ ...opts, limit: 1 });
    return result[0] ?? null;
  }

  async execWithCount(opts?: InputExecOpts<T>): Promise<[T[], number]> {
    opts = this.parseOpts(opts);
    /* If cacheCount is infinity, we know all the documents matching the query
     * are already stored on cache. We already have to grab and splice it,
     * so we might as well use the array length instead of another lookup.
     */
    if (this.cacheCount === Infinity) {
      const { skip, limit, ...rest } = opts;
      // note: if applicable, the filter func is already applied to fullResult.
      const fullResult = await this.exec({ ...rest, skip: 0 });
      const result = skipAndLimit<T>(fullResult, skip, limit);
      return [
        result,
        fullResult.length,
      ];
    }
    return Promise.all([
      this.exec(opts),
      this.count(opts),
    ]);
  }

  async count(opts?: InputExecOpts<T>) {
    const { redis } = this.context;
    opts = this.parseOpts(opts);
    const { params = [], filter, skipCache = false } = opts;
    if (filter) {
      const { skip, limit, ...rest } = opts;
      const fullResult = await this.exec({ ...rest, skip: 0 });
      return fullResult.length;
    }
    const cacheKey = this.getCacheKey(params);
    let count;
    if (!skipCache) {
      try {
        count = await redis.hget(cacheKey, 'count');
      } catch (err) {
        // logger.warn({ err, tag: 'CACHE_REDIS_GET', cacheKey }, 'Failed to HGET value');
      }
    }
    if (!count) {
      count = await this.countMongo(params);
      try {
        await redis.hset(cacheKey, 'count', count);
      } catch (err) {
        // logger.warn({ err, tag: 'CACHE_REDIS_SET', cacheKey }, 'Failed to set value');
      }
    }
    return typeof count === 'number' ? count : parseInt(count, 10);
  }

  /* Generates a hash of the config object used to create this CachedQuery.
   * Used in the redis key name. This is useful for versioning queries, as
   * updated queries will not clash with the old ones, which will simply expire away.
   */
  get hash() {
    if (!this._hash) {
      // extract config from self, ignoring some other keys
      const { _hash, context, ...config } = this;
      const queryFunc = config.query;
      if (typeof queryFunc === 'function') {
        const params = Array(queryFunc.length).fill(null).map((_v, i) => `$CQP${i}$`);
        config.query = queryFunc(...params);
      }
      const json = JSON.stringify(config);
      this._hash = crypto.createHash('sha1')
        .update(json).digest('base64').substring(0, 16);
    }
    return this._hash;
  }

  private parseOpts(opts?: InputExecOpts<T>): QueryExecOpts<T> {
    if (!opts) return {};
    if (Array.isArray(opts)) return { params: opts };
    if (opts.filter && this.cacheCount !== Infinity) throw Error('Filter can only be used with non-unique queries with cacheCount=Infinity');
    return opts;
  }
}

export default CachedQuery;
