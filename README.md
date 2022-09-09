# mondis

mongoose + redis = mondis.

## Setup

```typescript
import Mondis from 'mondis';
import Mongoose from 'mongoose';
import Redis from 'ioredis';

// create the mongoose/ioredis clients.
const mongoose = new Mongoose(); // or use the global instance
const redis = new Redis();

// initialize the mondis client
const mondis = new Mondis({ redis, mongoose });

// attach the plugin for invalidation handling
mongoose.plugin(mondis.plugin());
```

## Configuration

To define a new CachedQuery, call the `mondis.CachedQuery<T, P>(conf)` method while providing the following configuration object. The generic parameter `T` is the output document, and `P` is the query function's input parameters.

```typescript
type Configuration<T extends HasObjectId, P extends unknown[]> = {
  model: string;
  query: [P] extends [never] ? QueryFilter<T> : (...params: P) => QueryFilter<T>;
  select?: QueryProjection;
  populate?: QueryPopulation[];
  sort?: QuerySortOrder | null;
  cacheCount?: number;
  expiry?: number;
  unique?: boolean;
  invalidateOnInsert?: boolean;
  rehydrate?: boolean;
};
```

| Key                | Default      | Description |
| ------------------ | ------------ | ----------- |
| model              | \<required\> | Mongoose model name the query will execute on |
| query              | \<required\> | For static queries, a mongo query filter. For dynamic queries, a function that returns a mongo query filter. |
| select             | `{}`         | Mongoose document projection |
| populate           | `[]`         | Mongoose document populations |
| sort               | `null`       | Mongoose sorting order |
| cacheCount         | `20`         | Maximum number of documents to be cached (use `Infinity` for unlimited) |
| expiry             | `43200`      | Number of seconds the query will be cached (refreshes during fetch and rehydration) |
| unique             | `false`      | Whether or not the query uniquely identifies a single document (optimizes insert invalidations) |
| invalidateOnInsert | `true`       | Whether or not the query should be invalidated on insert events |
| rehydrate          | `true`       | Whether or not to rehydrate the cached queries after invalidation |

## Execution

**NOTE:** If the `skip` and/or `limit` values lie outside of the query's `cacheCount` range, the execution **will** fall back to mongo, and the result will not be cached! Keep the following details in mind:
* The default `cacheCount` is 20.
* If `limit` is `undefined` or not specified during execution, the query will always fall back to mongo **unless** `cacheCount` is set to `Infinity`!

[(further reading: Setting an appropriate `cacheCount`)](#setting-an-appropriate-cachecount)

### Options

After constructing a CachedQuery, it can be executed with the following options:
```typescript
type ExecOptions<T, P> = {
  params: P; // dynamic queries only
  skip?: number;
  limit?: number | undefined;
  filter?: (doc: T) => boolean;
  skipCache?: boolean;
};
```

| Key       | Default     | Description |
| --------- | ----------- | ----------- |
| params    | `[]`        | The parameters with which to execute the query (dynamic queries only) |
| skip      | `0`         | Number of documents to skip |
| limit     | `undefined` | Maximum number of documents to return |
| filter    | `undefined` | When using `cacheCount: Infinity`, filter the results before returning |
| skipCache | `false`     | Whether or not fetch data from the cache. The fetched result will still get cached |

### Methods

#### `exec(options: P | ExecOptions<T, P>): Promise<T[]>`
Fetch the result from cache, or fallback to mongo and cache the result.

#### `execOne(options: P | ExecOptions<T, P>): Promise<T | null>`
Same as `exec`, but only returns the first document.

#### `count(options: P | ExecOptions<T, P>): Promise<number>`
Returns the total number of documents matching the query. Note that this value represents the total count on mongo, it is not related to `cacheCount`.

#### `execWithCount(options: P | ExecOptions<T, P>): Promise<[ T[], number ]>`
Runs `exec` and `count` at the same time.

## Example queries

### Static query

A query that is not configurable upon execution, only one result is cached.

```typescript
const CheapVehicles = mondis.CachedQuery<Vehicle>({
  model: 'Vehicle',
  query: { price: { $lt: 2500 } },
});
```

### Dynamic query

A configurable query, where specific parameters must be passed for execution. Each unique set of parameters corresponds to one result stored on cache.

```typescript
const VehiclesByKind = mondis.CachedQuery<Vehicle, [string]>({
  model: 'Vehicle',
  query: (kind) => ({ kind }),
});
```

### Unique query

A unique query returns a single, uniquely identified document. The boolean is useful for optimizing insert invalidations, where we know a new document being inserted will never have an effect on the query result.

```typescript
const VehicleById = mondis.CachedQuery<Vehicle, [Types.ObjectId]>({
  model: 'Vehicle',
  query: (_id) => ({ _id }),
  unique: true,
});
```

### Complex query

A complex query is a query that uses a configurable parameter inside a mongo query operator. These queries lead to frequent or large invalidations, because we cannot lookup which specific queries require invalidation, and must instead invalidate **all** occurrences of the query. Proceed with caution! [(further reading: Invalidation)](#Invalidation)

```typescript
const VehiclesOverPrice = mondis.CachedQuery<Vehicle, [number]>({
  model: 'Vehicle',
  query: (minPrice) => ({ price: { $gte: minPrice } }),
});
```

### Targeted query

This query only fetches documents already known to exist, via a list of `_id`s. At the same time, it is also a complex query, meaning insert invalidations can be expensive. However, it can be observed that the insertion of any new document will have **no** effect on it, as the `_id`s must have already existed in the first place. By setting the `invalidateOnInsert` boolean to `false`, we can tell the invalidation handler to ignore all insert events for this query.

```typescript
const VehiclesById = mondis.CachedQuery<Vehicle, [Types.ObjectId[]]>({
  model: 'Vehicle',
  query: (_ids) => ({ _id: { $in: _ids } }),
  invalidateOnInsert: false,
});
```

## Query considerations

### Parameter cardinality

When defining dynamic queries, carefully consider the cardinality of your input parameter space. If the space is large and the query is likely to be called with different parameters each time, it may be worth considering a different query, or omitting caching entirely. Otherwise, it may lead to an excessive number of cached results, expensive invalidation handling, and low cache usage for the query.

For example, consider a query that only matches against a key with 3 possible values. There will be at most 3 keys stored on the cache, meaning they are more likely to be re-used, and invalidation handling is manageable.

On the other hand, consider a query where the parameter is a list of specific `_id`s to exclude, and this list is likely to be different for each execution. This query is likely to run into the issues mentioned above! (For this specific use-case, consider using the `filter` exec option instead)[]

### Setting an appropriate `cacheCount`

When deciding on a `cacheCount` to use, consider the following:
* If the query will be used as part of a pagination pattern, set `cacheCount` to match the number of pages you wish to cache.
* If the query always returns a manageable number of documents, consider setting `cacheCount` to `Infinity`. This way, any combination of skip/limit during execution will still fetch from the cache instead of falling back to mongo.

### Time-dependent queries

Queries that change based on _when_ they are called should never be cached!

## Implementation details

TODO
