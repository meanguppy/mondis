import type {
  HydratedDocument,
  Model,
  Query,
  Schema,
  Types,
} from 'mongoose';
import {
  mapBeforeAndAfter,
  buildUpsertedDocument,
  collectModifiedKeys,
  parseQueryUpdate,
} from './mongo-operators';
import type {
  CacheEffect,
  HasObjectId,
} from '../types';

type DocumentWithId = HydratedDocument<unknown>;

type QueryExtras<ResType = unknown> =
  & Query<ResType, HasObjectId>
  & { op: string }
  & { updatedIds?: Types.ObjectId[] };

async function findDocs(updateQuery: QueryExtras, idOnly = false) {
  const firstOnly = updateQuery.op.includes('One');
  const { strict, strictQuery } = updateQuery.getOptions();
  const query = updateQuery.model.find(updateQuery.getFilter()).lean();
  if (idOnly) query.select('_id');
  if (firstOnly) query.limit(1);
  if (strict !== undefined) query.setOptions({ strict });
  if (strictQuery !== undefined) query.setOptions({ strictQuery });
  return query.exec() as Promise<HasObjectId[]>;
}

function getDocumentInfo(doc: DocumentWithId) {
  const { _id, isNew, constructor } = doc;
  const { modelName } = constructor as Model<unknown>;
  return { _id, modelName, isNew };
}

function getQueryInfo(query: QueryExtras) {
  const { model: { modelName } } = query;
  const { upsert = false } = query.getOptions();
  const update = parseQueryUpdate(query.getUpdate());
  const filter = query.getFilter();
  return { modelName, upsert, update, filter };
}

const DOCS = { document: true, query: false } as const;
const QUERIES = { document: false, query: true } as const;

type CacheEffectReceiver = {
  onCacheEffect(evt: CacheEffect): unknown;
};

export default function bindPlugin(target: CacheEffectReceiver) {
  function effect(evt: CacheEffect) {
    return target.onCacheEffect(evt);
  }
  // TODO: start promise in pre middleware, but await it in post.
  return function mondisPlugin(schema: Schema) {
    async function preDocSave(this: DocumentWithId) {
      const { _id, modelName, isNew } = getDocumentInfo(this);
      if (!modelName) return; // embedded document creation, ignore
      if (isNew) {
        await effect({ op: 'insert', modelName, docs: [this.toObject()] });
      } else {
        const modified = this.directModifiedPaths();
        if (!modified.length) return;
        const before = await this.$model(modelName).findById(_id).lean();
        if (!before) return;
        const after = this.toObject();
        await effect({ op: 'update', modelName, modified, docs: [{ before, after }] });
      }
    }

    async function preDocRemove(this: DocumentWithId) {
      const { _id } = getDocumentInfo(this);
      await effect({ op: 'remove', ids: [_id] });
    }

    async function preQueryUpdate(this: QueryExtras) {
      const { modelName, update, filter, upsert } = getQueryInfo(this);
      const docs = await findDocs(this.clone(), false);
      if (docs.length) {
        const modified = collectModifiedKeys(update);
        const beforeAndAfter = mapBeforeAndAfter(docs, update);
        await effect({ op: 'update', modelName, modified, docs: beforeAndAfter });
      } else if (upsert) {
        const upserted = buildUpsertedDocument(filter, update);
        await effect({ op: 'insert', modelName, docs: [upserted] });
      }
    }

    async function preQueryRemove(this: QueryExtras) {
      const docs = await findDocs(this.clone(), true);
      if (docs.length) {
        await effect({ op: 'remove', ids: docs.map((doc) => doc._id) });
      }
    }

    async function preInsertMany(this: Model<unknown>, next: () => void, input: unknown) {
      // Unfortunately this middleware executes before the Documents are constructed,
      // meaning default value are missing. Create document only to pass to invalidation
      const { modelName } = this;
      const docs = (Array.isArray(input) ? input : [input])
        .map((item) => new this(item).toObject());
      await effect({ op: 'insert', modelName, docs });
      next();
    }

    schema.pre(['save', 'updateOne'], DOCS, preDocSave);
    schema.pre(['remove', 'deleteOne'], DOCS, preDocRemove);
    schema.pre(['update', 'updateOne', 'updateMany', 'findOneAndUpdate'], QUERIES, preQueryUpdate);
    schema.pre(['remove', 'deleteOne', 'deleteMany', 'findOneAndRemove', 'findOneAndDelete'], QUERIES, preQueryRemove);
    schema.pre('insertMany', preInsertMany);
  };
}
