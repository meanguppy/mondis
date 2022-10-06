import type {
  HasObjectId,
  QueryFilter,
  QueryPopulation,
  QueryProjection,
  QuerySort,
} from './types';

type InputPopulation = Record<string, {
  model: string;
  select?: QueryProjection;
  populate?: InputPopulation;
}>;

export type InputConfig<P extends unknown[] = unknown[]> = {
  model: string;
  query: [P] extends [never]
    ? QueryFilter
    : (...params: P) => QueryFilter;
  select?: QueryProjection;
  populate?: InputPopulation;
  sort?: QuerySort | null;
  cacheCount?: number;
  unique?: boolean;
  invalidateOnInsert?: boolean;
  expiry?: number;
  rehydrate?: boolean;
};

type ParsedConfig<P extends unknown[]> = {
  model: string;
  query: [P] extends [never]
    ? QueryFilter
    : (...params: P) => QueryFilter;
  select: QueryProjection;
  populate: QueryPopulation[];
  sort: QuerySort | null;
  cacheCount: number;
  unique: boolean;
  invalidateOnInsert: boolean;
  expiry: number;
  rehydrate: boolean;
};

export type CachedQueryConfig<
  T extends HasObjectId = HasObjectId,
  P extends unknown[] = never,
> = ParsedConfig<P> & { __brand: T };

function transformPopulate(input: InputPopulation): QueryPopulation[] {
  return Object.entries(input).map(([path, config]) => {
    const { model, select, populate } = config;
    return {
      path,
      model,
      ...(select ? { select } : {}),
      ...(populate ? { populate: transformPopulate(populate) } : {}),
    };
  });
}

function selectPopulations(select: QueryProjection, populate: InputPopulation) {
  const isInclusiveSelect = Object.entries(select).every(
    ([path, pick]) => pick !== 0 || path === '_id',
  );
  if (!isInclusiveSelect) return select;
  return {
    ...select,
    ...Object.fromEntries(
      Object.keys(populate).map((path) => [path, 1]),
    ),
  };
}

export function parseConfig<
  T extends HasObjectId,
  P extends unknown[] = never,
>(config: InputConfig<P>): CachedQueryConfig<T, P> {
  const {
    model,
    query,
    select = {},
    populate = {},
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
    select: selectPopulations(select, populate),
    populate: transformPopulate(populate),
    sort,
    cacheCount,
    expiry,
    unique,
    invalidateOnInsert,
    rehydrate,
  };
  return parsed as CachedQueryConfig<T, P>;
}
