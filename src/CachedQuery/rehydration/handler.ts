import { EJSON } from 'bson';
import type Mondis from 'src/mondis';

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
  constructor(
    readonly context: Mondis,
  ) { }

  private async rehydrate(keys: string[]) {
    if (!keys.length) return;
    const { queries } = this.context;

    Object.values(queries).forEach((query) => {
    });
    // const { lookupCachedQuery } = this.context;
    // const promises = keys.map(async (key) => {
    //   const { hash, params } = parseCacheKey(key);
    //   const query = lookupCachedQuery.get(hash);
    //   if (!query || !query.config.rehydrate) return;
    //   await query.exec({ params, limit: query.config.cacheCount, skipCache: true });
    // });

    // await Promise.all(promises);
  }
}
