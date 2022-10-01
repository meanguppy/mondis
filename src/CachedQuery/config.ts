import type {
  HasObjectId,
  QueryFilter,
  QueryPopulation,
  QueryProjection,
  QuerySort,
} from './types';

type InputConfig<P extends unknown[]> = {
  model: string;
  query: [P] extends [never]
    ? QueryFilter
    : (...params: P) => QueryFilter;
  select?: QueryProjection;
  populate?: QueryPopulation[];
  sort?: QuerySort | null;
  cacheCount?: number;
  unique?: boolean;
  invalidateOnInsert?: boolean;
  expiry?: number;
  rehydrate?: boolean;
};

type ParsedConfig<P extends unknown[]> = Required<InputConfig<P>>;

export type CachedQueryConfig<
  T extends HasObjectId = HasObjectId,
  P extends unknown[] = never,
> = ParsedConfig<P> & { __brand: T };

export function parseConfig<
  T extends HasObjectId,
  P extends unknown[] = never,
>(config: InputConfig<P>): CachedQueryConfig<T, P> {
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
  const parsed: ParsedConfig<P> = {
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
  return parsed as CachedQueryConfig<T, P>;
}
