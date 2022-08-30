import AbstractCacheable from './AbstractCacheable';
import type Mondis from '../mondis';

type CachedValueConfig<T> = {
  name: string;
  expiry: number;
  fetchData: (params: unknown[]) => Promise<T | null>;
};

class CachedValue<T> extends AbstractCacheable<T, unknown[]> {
  context: Mondis;

  name: string;

  expiry: number;

  userFetchData: (params: unknown[]) => Promise<T | null>;

  constructor(context: Mondis, config: CachedValueConfig<T>) {
    super();
    const { name, expiry, fetchData } = config;
    this.name = name;
    this.expiry = expiry;
    this.context = context;
    this.userFetchData = fetchData;
  }

  makeCacheKey(params: unknown[]) {
    return `v:${this.name}${JSON.stringify(params)}`;
  }

  async fetchData(params: unknown[]) {
    return this.userFetchData(params);
  }

  // async fetchCache(key: string, params: unknown[]) {
  async fetchCache(key: string) {
    const { redis } = this.context;
    let json;
    try {
      json = await redis.get(key);
    } catch (err) {
      // logger
    }
    return json ? (JSON.parse(json) as T | null) : undefined;
  }

  // async updateCache(key: string, data: T | null, params: unknown[]) {
  async updateCache(key: string, data: T | null) {
    const { redis } = this.context;
    try {
      const json = JSON.stringify(data);
      await redis.setex(key, this.expiry, json);
    } catch (err) {
      // logger
    }
  }
}

export default CachedValue;
