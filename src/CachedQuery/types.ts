import type { QueryOptions, SortOrder, Types } from 'mongoose';

export type MongooseProjection = Record<string, unknown>;

// stricter version of mongoose.PopulateOptions
export type MongoosePopulation = {
  path: string;
  select?: MongooseProjection;
  match?: unknown;
  model?: string;
  options?: QueryOptions;
  perDocumentLimit?: number;
  strictPopulate?: boolean;
  populate?: MongoosePopulation[];
  justOne?: boolean;
  transform?: (doc: unknown, id: unknown) => unknown;
};

export type MongooseSortConfig = string | { [key: string]: SortOrder };

export type QueryKeysClassification = {
  staticKeys: Record<string, unknown>;
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
  | { op: 'insert', modelName: string, docs: HasObjectId[] }
  | { op: 'remove', modelName: string, ids: Types.ObjectId[] };
