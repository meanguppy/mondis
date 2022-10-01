import type { SortOrder, Types } from 'mongoose';
import type sift from 'sift';

export type AnyObject = Record<string, unknown>;
export type HasObjectId = {
  _id: Types.ObjectId;
  [key: string]: unknown;
};

export type QueryFilter = AnyObject;
export type QueryProjection = AnyObject;
export type QueryPopulation = {
  path: string;
  model: string;
  select?: QueryProjection;
  populate?: QueryPopulation[];
};
export type QuerySort = Record<string, SortOrder>;
export type QueryInfo = {
  matcher: ReturnType<typeof sift>;
  dynamicKeys: string[];
  complexQuery: boolean;
  selectInclusive: boolean;
  selectPaths: string[];
  sortPaths: string[];
};
export type QuerySelectInfo = Pick<QueryInfo, 'selectInclusive' | 'selectPaths'>;
export type QueryFilterInfo = Pick<QueryInfo, 'matcher' | 'dynamicKeys' | 'complexQuery'>;

export type CacheEffect =
  | { op: 'update', modelName: string, modified: string[], docs: { before: AnyObject, after: AnyObject }[] }
  | { op: 'insert', modelName: string, docs: AnyObject[] }
  | { op: 'remove', ids: Types.ObjectId[] };
