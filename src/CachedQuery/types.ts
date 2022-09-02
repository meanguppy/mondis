import type { PopulateOptions, SortOrder, Types } from 'mongoose';

// TODO: consider more strict definition, future features may bar complex selects.
export type MongooseProjection = Record<string, unknown>;

export type MongoosePopulations = Array<{
  [P in keyof PopulateOptions]: P extends 'populate'
    ? MongoosePopulations
    : PopulateOptions[P];
}>;

export type MongooseSortConfig = string | { [key: string]: SortOrder };

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
