import type { FilterQuery, PopulateOptions, SortOrder } from 'mongoose';
import * as crypto from 'crypto';
import type Mondis from '..';
import { collectPopulatedIds, skipAndLimit } from './lib';

export type QueryResult<T> =
  ReturnType<CachedQuery<T>['execMongo']> extends Promise<infer V> ? V : never;

// TODO: clean up `object` here?
export type MongooseProjection = { [key: string]: 0 | 1 | object };

export type MongoosePopulations = Array<{
  [P in keyof PopulateOptions]: P extends 'populate'
    ? MongoosePopulations
    : PopulateOptions[P]
}>;

export type MongooseSortConfig = string | { [key: string]: SortOrder };

type ConfigInput<T> = {
  model: string;
  query: FilterQuery<T> | ((...params: unknown[]) => FilterQuery<T>);
  select?: MongooseProjection;
  populate?: MongoosePopulations;
  sort?: MongooseSortConfig | null;
  cacheCount?: number;
  unique?: boolean;
  invalidateOnInsert?: boolean;
  expiry?: number;
  rehydrate?: boolean;
};

type Config<T> = Required<ConfigInput<T>>;

type QueryExecOpts<T> = {
  params?: unknown[],
  limit?: number,
  skip?: number,
  filter?: (doc: T) => boolean,
  skipCache?: boolean
};

type InputExecOpts<T> = unknown[] | QueryExecOpts<T>;

class CachedQuery<T> implements Config<T> {
  context: Mondis;

  private _hash?: string;

  model: string;

  query: FilterQuery<T> | ((...params: unknown[]) => FilterQuery<T>);

  select: MongooseProjection;

  populate: MongoosePopulations;

  sort: MongooseSortConfig | null;

  cacheCount: number;

  expiry: number;

  unique: boolean;

  invalidateOnInsert: boolean;

  rehydrate: boolean;

  constructor(context: Mondis, config: ConfigInput<T>) {
    this.context = context;
    const {
      model,
      query,
      select = {},
      populate = [],
      sort = null,
      cacheCount = 10,
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
    const paramsStr = JSON.stringify(params);
    return `q:${hash}${paramsStr}`;
  }

  getCacheKeyForAll() {
    return `all:${this.hash}`;
  }

  private buildQuery(opts?: InputExecOpts<T>) {
    const { mongoose } = this.context.clients;
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
    populate.forEach((pop) => {
      q.populate(pop);
    });
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

  private async getFullJson(opts?: InputExecOpts<T>) {
    const { redis } = this.context.clients;
    opts = this.parseOpts(opts);
    const {
      params = [], skip = 0, limit, skipCache = false,
    } = opts;
    const { cacheCount } = this;
    // query is outside cacheable skip/limit, fall back to mongo query and do not cache
    if ((cacheCount < Infinity && limit === undefined) || (limit && (limit + skip) > cacheCount)) {
      const mongoRes = await this.execMongo(opts);
      return { hasAll: false, json: JSON.stringify(mongoRes) };
    }

    let json;
    const cacheKey = this.getCacheKey(params);
    if (!skipCache) {
      try {
        json = await redis.hget(cacheKey, 'value');
      } catch (err) {
        // logger.warn({ err, tag: 'CACHE_REDIS_GET', cacheKey }, 'Failed to HGET value');
      }
    }
    if (!json) {
      const mongoRes = await this.execMongo({ params, limit: cacheCount });
      /* If a unique query has no results, do not cache the empty array.
       * The matching item could still be inserted at a later time, and because
       * unique queries do not invalidate upon document insert, that event
       * would not be detected for invalidation. */
      if (mongoRes.length > 0 || !this.unique) {
        json = await this.stringifyAndCache(mongoRes, cacheKey);
      } else {
        json = JSON.stringify(mongoRes);
      }
    }
    return { hasAll: true, json };
  }

  /**
   * Stringifies the result object and stores it in cache.
   */
  private async stringifyAndCache(result: QueryResult<T>, cacheKey: string) {
    const { redis } = this.context.clients;
    const json = JSON.stringify(result);
    try {
      const depends = collectPopulatedIds(result, this.populate);
      const allKey = this.getCacheKeyForAll();
      // Cache result, and create keys used for tracking invalidations
      const multi = redis.multi();
      multi.del(cacheKey);
      multi.hset(cacheKey, 'value', json);
      multi.hset(cacheKey, 'depends', depends.join(' '));
      multi.sadd(allKey, cacheKey);
      multi.call('expiregt', cacheKey, this.expiry);
      multi.call('expiregt', allKey, this.expiry);
      depends.forEach((id) => {
        multi.sadd(`obj:${id}`, cacheKey);
        multi.call('expiregt', `obj:${id}`, this.expiry);
      });
      await multi.exec();
    } catch (err) {
      // logger.warn({ err, tag: 'CACHE_REDIS_SET', cacheKey, result, }, 'Failed to set value');
    }
    return json;
  }

  async exec(opts?: InputExecOpts<T>) {
    opts = this.parseOpts(opts);
    const { filter, skip, limit } = opts;
    const { hasAll, json } = await this.getFullJson(opts);
    // TODO: investigate the type T and cast here...
    let result = JSON.parse(json) as Array<T>;

    /* hasAll=false means this exec's skip/limit lies outside of the cacheCount,
     *   so we fell back to mongo and already applied the skip/limit.
     * hasAll=true means the array contains all documents up to the cacheCount,
     *   so we must still apply this exec's skip/limit to the array.
     * Note: filterable queries require cacheCount=Infinity, so hasAll is always true.
     */
    if (hasAll) {
      if (filter) result = result.filter(filter);
      result = skipAndLimit(result, skip, limit);
    }

    return result;
  }

  async execOne(opts?: InputExecOpts<T>) {
    opts = this.parseOpts(opts);
    const result = await this.exec({ ...opts, limit: 1 });
    return (result && result.length) ? result[0] : null;
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
    const { redis } = this.context.clients;
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
      const { _hash, ...config } = this;
      const queryFunc = config.query;
      if (typeof queryFunc === 'function') {
        const params = Array(queryFunc.length).fill(null).map((v, i) => `_$CQP${i}$_`);
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
