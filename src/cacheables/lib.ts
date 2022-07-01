import type { Types } from 'mongoose';
import get from 'lodash.get';
import type { MongoosePopulation } from './CachedQuery';

type MaybeHasId = { _id?: Types.ObjectId };
/**
 * Extract all ObjectIds of documents based on the
 * mongoose population config. Embedded documents not included
 */
export function collectPopulatedIds(docs: MaybeHasId[], populations?: MongoosePopulation) {
  const initial = docs.filter((doc) => !!doc._id).map((doc) => String(doc._id));
  if (!populations?.length) return initial;
  const result = new Set(initial);

  docs.forEach((doc) => {
    populations.forEach(({ path, populate: innerPopulate }) => {
      const inner: unknown = get(doc, path);
      if (!inner || typeof inner !== 'object') return;

      const items: MaybeHasId[] = Array.isArray(inner) ? inner : [inner];
      items.forEach((innerDoc) => {
        if (!innerDoc || typeof innerDoc !== 'object' || !innerDoc._id) return;
        if (innerPopulate) {
          collectPopulatedIds([innerDoc], innerPopulate).forEach((id) => result.add(id));
        } else {
          result.add(String(innerDoc._id));
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
