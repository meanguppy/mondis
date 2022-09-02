import { serialize, deserialize } from 'bson';
import type Mondis from '../mondis';
import type {
  MongoosePopulation,
  MongooseProjection,
  MongooseSortConfig,
  QueryKeysClassification,
} from './types';
import {
  classifyQueryKeys,
  collectPopulatedIds,
  jsonHash,
  skipAndLimit,
} from './lib';

type CachedQueryConfig = {
  model: string;
  query: Record<string, unknown> | ((...params: unknown[]) => Record<string, unknown>);
  select?: MongooseProjection;
  populate?: MongoosePopulation[];
  sort?: MongooseSortConfig | null;
  cacheCount?: number;
  unique?: boolean;
  invalidateOnInsert?: boolean;
  expiry?: number;
  rehydrate?: boolean;
};

type QueryExecOpts<T> = {
  params?: unknown[];
  limit?: number;
  skip?: number;
  filter?: (doc: T) => boolean;
  skipCache?: boolean;
};

type InputExecOpts<T> = unknown[] | QueryExecOpts<T>;

class CachedQuery<T> {
  context: Mondis;

  config: Required<CachedQueryConfig>;

  private _hash?: string;

  private _classification?: QueryKeysClassification;

  constructor(context: Mondis, config: CachedQueryConfig) {
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
    this.config = {
      model,
      query,
      select,
      populate,
      sort,
      cacheCount,
      expiry,
      unique,
      invalidateOnInsert,
      rehydrate,
    };
  }

  getCacheKey(params: unknown[] = []) {
    const { hash, config: { query } } = this;
    const expectNumParams = (typeof query === 'function') ? query.length : 0;
    if (expectNumParams !== params.length) {
      throw Error(`Invalid number of params passed: expected ${expectNumParams}, got ${params.length}`);
    }
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
      model, query, unique, select, sort, populate,
    } = this.config;
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
    const { populate, expiry } = this.config;
    try {
      const bson = serialize(result);
      const depends = collectPopulatedIds(result, populate);
      const allKey = this.getCacheKeyForAll();
      // Cache result, and create keys used for tracking invalidations
      const multi = redis.multi();
      multi.del(cacheKey);
      multi.hset(cacheKey, 'value', bson);
      multi.hset(cacheKey, 'depends', depends.join(' '));
      multi.sadd(allKey, cacheKey);
      multi.expiregt(cacheKey, expiry);
      multi.expiregt(allKey, expiry);
      depends.forEach((id) => {
        multi.sadd(`obj:${id}`, cacheKey);
        multi.expiregt(`obj:${id}`, expiry);
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
    const { cacheCount, unique } = this.config;

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
    const { cacheCount } = this.config;
    /* If cacheCount is infinity, we know all the documents matching the query
     * are already stored on cache. We already have to grab and splice it,
     * so we might as well use the array length instead of another lookup.
     */
    if (cacheCount === Infinity) {
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

  private parseOpts(opts?: InputExecOpts<T>): QueryExecOpts<T> {
    if (!opts) return {};
    if (Array.isArray(opts)) return { params: opts };
    const { cacheCount } = this.config;
    if (opts.filter && cacheCount !== Infinity) throw Error('Filter can only be used with non-unique queries with cacheCount=Infinity');
    return opts;
  }

  /* Generates a hash of the config object used to create this CachedQuery.
   * Used in the redis key name. This is useful for versioning queries, as
   * updated queries will not clash with the old ones, which will simply expire away.
   */
  get hash() {
    if (!this._hash) {
      let { query } = this.config;
      if (typeof query === 'function') {
        const params = Array(query.length).fill(null).map((_v, i) => `$CQP${i}$`);
        query = query(...params);
      }
      this._hash = jsonHash({ ...this.config, query });
    }
    return this._hash;
  }

  get classification() {
    if (!this._classification) {
      const { query } = this.config;
      this._classification = classifyQueryKeys(query);
    }
    return this._classification;
  }
}

export default CachedQuery;
