# mondis

mongoose + redis = mondis.

## Setup

```typescript
import Mondis from 'mondis';
import Mongoose from 'mongoose';
import Redis from 'ioredis';

// create your mongoose/ioredis clients.
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
| query              | \<required\> | For static queries, a mongo query filter. For dynamic queries, a function that returns a mongo query filter |
| select             | `{}`         | Mongoose document projection |
| populate           | `[]`         | Mongoose document populations |
| sort               | `null`       | Mongoose sorting order |
| cacheCount         | `Infinity`   | The maximum number of documents that will be stored in cache |
| expiry             | `43200`      | Number of seconds the query will be cached (refreshes during fetch and rehydration) |
| unique             | `false`      | Whether or not the query uniquely identifies a single document (optimizes insert invalidations) |
| invalidateOnInsert | `true`       | Whether or not the query should be invalidated on insert events |
| rehydrate          | `true`       | Whether or not to rehydrate the cached queries after invalidation |

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
const VehicleByKind = mondis.CachedQuery<Vehicle, [string]>({
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

A complex query is a query that uses a configurable parameter inside a mongo query operator. These queries lead to frequent or large invalidations, because we cannot lookup which specific queries require invalidation, and must instead invalidate **all** occurrences of the query. Proceed with caution! [Further details can be found in the invalidation section](#Invalidation).

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

# WORK-IN-PROGRESS

## Query definition considerations

* Parameter cardinality
* Time-based queries should be avoided

## Invalidation

### Complex query

Example: The query is executed with `minPrice` set to `2000`; the result and parameters are stored on the cache. When a document is updated or inserted with `price: 3000`, we cannot establish which cache keys require invalidation _directly_, as there are infinite ways to satisfy the query.