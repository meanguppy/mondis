import AbstractCacheable from './AbstractCacheable';
import Mondis from '..';

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

  makeCacheKey(params: unknown[]): string {
    return `v:${this.name}${JSON.stringify(params)}`;
  }

  async fetchData(params: unknown[]): Promise<T | null> {
    return this.userFetchData(params);
  }

  async fetchCache(key: string, params: unknown[]): Promise<T | null | undefined> {
    const { redis } = this.context.clients;
    let json;
    try {
      json = await redis.get(key);
    } catch (err) {
      // logger
    }
    return json ? JSON.parse(json) : undefined;
  }

  async updateCache(key: string, data: T | null, params: unknown[]): Promise<void> {
    const { redis } = this.context.clients;
    try {
      const json = JSON.stringify(data);
      await redis.setex(key, this.expiry, json);
    } catch (err) {
      // logger
    }
  }
}

export default CachedValue;
