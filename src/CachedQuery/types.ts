import type { QueryOptions, SortOrder, Types } from 'mongoose';
import type sift from 'sift';

export type AnyObject = Record<string, unknown>;

export type QueryFilter = AnyObject;

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

export type QuerySortOrder = string | Record<string, SortOrder>;

export type QueryInfo = {
  query: {
    matcher: ReturnType<typeof sift>;
    dynamicKeys: string[];
    complexQuery: boolean;
  };
  select: {
    inclusive: boolean;
    keepId: boolean;
    paths: string[];
  };
};

export type HasObjectId = {
  _id: Types.ObjectId;
  [key: string]: unknown;
};

export type CacheEffect =
  | { op: 'update', modelName: string, modified: string[], docs: { before: AnyObject, after: AnyObject }[] }
  | { op: 'insert', modelName: string, docs: AnyObject[] }
  | { op: 'remove', ids: Types.ObjectId[] };
