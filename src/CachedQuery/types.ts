import type { QueryOptions, SortOrder, Types } from 'mongoose';
import type sift from 'sift';

export type AnyObject = Record<string, unknown>;

export type QueryFilter<T = unknown> =
  T extends AnyObject
    ? { [P in keyof T]?: unknown }
    : {};

export type QueryProjection = AnyObject;

export type QueryPopulation = {
  path: string;
  select?: QueryProjection;
  match?: unknown;
  model?: string;
  options?: QueryOptions;
  perDocumentLimit?: number;
  strictPopulate?: boolean;
  populate?: QueryPopulation[];
  justOne?: boolean;
  transform?: (doc: unknown, id: unknown) => unknown;
};

export type QuerySortOrder = string | { [key: string]: SortOrder };

export type QueryKeysClassification = {
  matcher: ReturnType<typeof sift>;
  dynamicKeys: string[];
  complexQuery: boolean;
};

export type HasObjectId = {
  _id: Types.ObjectId;
  [key: string]: unknown;
};

/**
 * There are only two ways in which the cache recognizes events:
 * 1. Insert: documents were inserted into the DB.
 * 2. Remove: documents were removed from the DB.
 * Note: database updates are handled as if they were removed and then re-inserted!
 */
export type CacheEffect =
  | { op: 'insert', modelName: string, docs: AnyObject[] }
  | { op: 'remove', modelName: string, ids: Types.ObjectId[] };
