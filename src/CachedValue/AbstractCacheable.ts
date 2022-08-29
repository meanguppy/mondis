abstract class AbstractCacheable<T, U> {
  abstract makeCacheKey(params: U): string;

  abstract fetchData(params: U): Promise<T | null>;

  abstract fetchCache(key: string, params: U): Promise<T | null | undefined>;

  abstract updateCache(key: string, data: T | null, params: U): Promise<void>;

  /* Get data from cache, or fallback and store on cache. */
  async exec(params: U) {
    const cacheKey = this.makeCacheKey(params);
    const result = await this.fetchCache(cacheKey, params);
    if (result !== undefined) return result;
    const data = await this.fetchData(params);
    await this.updateCache(cacheKey, data, params);
    return data;
  }

  /* Get data from cache only, do not fallback if missing. */
  async fetch(params: U) {
    const cacheKey = this.makeCacheKey(params);
    return this.fetchCache(cacheKey, params);
  }

  /* Generate fresh data, store it on cache, and return it. */
  async rehydrate(params: U) {
    const cacheKey = this.makeCacheKey(params);
    const data = await this.fetchData(params);
    await this.updateCache(cacheKey, data, params);
    return data;
  }

  /* Generate fresh data and return it. Do not cache. */
  async fallback(params: U) {
    return this.fetchData(params);
  }
}

export default AbstractCacheable;
