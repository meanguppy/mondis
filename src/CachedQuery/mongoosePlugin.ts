import type {
  HydratedDocument,
  Model,
  Query,
  Schema,
  Types,
} from 'mongoose';
import { applyUpdateQuery, buildUpsertedDocument } from './mongoOperators';
import type {
  CacheEffect,
  HasObjectId,
} from './types';

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
  const update = query.getUpdate();
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
    target.onCacheEffect(evt);
  }
  return function mondisPlugin(schema: Schema) {
    function preDocSave(this: DocumentWithId) {
      const { _id, modelName, isNew } = getDocumentInfo(this);
      if (!modelName) return; // embedded document creation, ignore
      if (!isNew) effect({ op: 'remove', modelName, ids: [_id] });
      effect({ op: 'insert', modelName, docs: [this.toObject()] });
    }

    function preDocRemove(this: DocumentWithId) {
      const { _id, modelName } = getDocumentInfo(this);
      effect({ op: 'remove', modelName, ids: [_id] });
    }

    async function preQueryUpdate(this: QueryExtras) {
      const { modelName, update, filter, upsert } = getQueryInfo(this);
      const docs = await findDocs(this.clone(), false);
      if (docs.length) {
        applyUpdateQuery(docs, update);
        effect({ op: 'remove', modelName, ids: docs.map((doc) => doc._id) });
        effect({ op: 'insert', modelName, docs });
      } else if (upsert) {
        const upserted = buildUpsertedDocument(filter, update);
        effect({ op: 'insert', modelName, docs: [upserted] });
      }
    }

    async function preQueryRemove(this: QueryExtras) {
      const { modelName } = getQueryInfo(this);
      const docs = await findDocs(this.clone(), true);
      if (docs.length) {
        effect({ op: 'remove', modelName, ids: docs.map((doc) => doc._id) });
      }
    }

    function preInsertMany(this: Model<unknown>, next: () => void, input: unknown) {
      // Unfortunately this middleware executes before the Documents are constructed,
      // meaning default value are missing. Create document only to pass to invalidation
      const { modelName } = this;
      const docs = (Array.isArray(input) ? input : [input])
        .map((item: unknown) => new this(item).toObject());
      effect({ op: 'insert', modelName, docs });
      next();
    }

    schema.pre(['save', 'updateOne'], DOCS, preDocSave);
    schema.pre(['remove', 'deleteOne'], DOCS, preDocRemove);
    schema.pre(['update', 'updateOne', 'updateMany', 'findOneAndUpdate'], QUERIES, preQueryUpdate);
    schema.pre(['remove', 'deleteOne', 'deleteMany', 'findOneAndRemove', 'findOneAndDelete'], QUERIES, preQueryRemove);
    schema.pre('insertMany', preInsertMany);
  };
}
