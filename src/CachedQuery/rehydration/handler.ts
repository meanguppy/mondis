import { EJSON } from 'bson';
import type Mondis from 'src/mondis';
import type CachedQuery from '..';

const MATCH_CACHE_KEY = /^Q:(.+?)(\[.*\])$/;
function parseCacheKey(key: string) {
  const [, hash, params] = key.match(MATCH_CACHE_KEY) || [];
  if (!hash || !params) throw Error('Failed to parse cache key');
  return {
    hash,
    params: EJSON.parse(params) as unknown[],
  };
}

export default class RehydrationHandler {
  private lookupCachedQuery?: Map<string, CachedQuery>;

  constructor(
    readonly context: Mondis,
  ) { }

  async rehydrate(keys: string[]) {
    if (!keys.length) return;

    const promises = keys.map(async (key) => {
      // TODO: try/catch and add logger for failures
      const { hash, params } = parseCacheKey(key);
      const cachedQuery = this.findCachedQuery(hash);
      if (!cachedQuery || !cachedQuery.config.rehydrate) return;

      await cachedQuery.exec({
        params,
        limit: cachedQuery.config.cacheCount,
        skipCache: true,
      });
    });

    await Promise.allSettled(promises);
  }

  private findCachedQuery(hash: string) {
    if (!this.lookupCachedQuery) {
      const map = new Map<string, CachedQuery>();
      Object.values(this.context.queries).forEach((query) => {
        map.set(query.hash, query);
      });
      this.lookupCachedQuery = map;
    }
    return this.lookupCachedQuery.get(hash);
  }
}
