import { Types } from 'mongoose';
import get from 'lodash.get';
import type { MongoosePopulations } from '.';

const { ObjectId } = Types;
type HasObjectId = { _id: Types.ObjectId };

function hasObjectId(target: unknown): target is HasObjectId {
  return (
    !!target
    && typeof target === 'object'
    && (target as { _id?: unknown })._id instanceof ObjectId
  );
}
/**
 * Extract all ObjectIds of documents based on the
 * mongoose population config. Embedded documents not included
 */
export function collectPopulatedIds(
  docs: Partial<HasObjectId>[],
  populations?: MongoosePopulations,
) {
  const initial = docs.filter((doc) => !!doc._id).map((doc) => String(doc._id));
  if (!populations?.length) return initial;
  const result = new Set(initial);

  docs.forEach((doc) => {
    populations.forEach(({ path, populate: innerPopulate }) => {
      const inner: unknown = get(doc, path);
      if (!inner || typeof inner !== 'object') return;

      const items: unknown[] = Array.isArray(inner) ? inner : [inner];
      items.forEach((innerVal) => {
        if (!hasObjectId(innerVal)) return;
        if (innerPopulate) {
          collectPopulatedIds([innerVal], innerPopulate).forEach((id) => result.add(id));
        } else {
          result.add(String(innerVal._id));
        }
      });
    });
  });

  return [...result];
}

/**
 * Splices an array to emulate skipping and limiting, with safe params.
 */
export function skipAndLimit<T>(array: T[], skip?: number, limit?: number) {
  skip = (typeof skip === 'number') ? skip : 0;
  limit = (typeof limit === 'number') ? limit : undefined;
  if (skip < 0) throw Error('Skip must be zero or a positive integer');
  if (limit !== undefined && limit <= 0) throw Error('Limit must be a positive integer');
  if (skip > 0 || limit) {
    return array.slice(skip, limit ? (skip + limit) : undefined);
  }
  return array;
}
