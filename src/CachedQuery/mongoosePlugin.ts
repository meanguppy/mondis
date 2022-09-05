import {
  HydratedDocument,
  Model,
  Query,
  Schema,
  Types,
  UpdateWriteOpResult,
  Document,
} from 'mongoose';
import type {
  CacheEffect,
  HasObjectId,
} from './types';

type DocumentWithId = HydratedDocument<unknown>;

type QueryExtras<ResType = unknown> =
  & Query<ResType, HasObjectId>
  & { op: string }
  & { updatedIds?: Types.ObjectId[] };

async function findIds(query: QueryExtras, firstOnly = false) {
  const cursor = query.cursor({
    lean: true,
    projection: '_id',
    ...(firstOnly && { limit: 1 }),
  });
  const result = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    result.push(doc._id);
  }
  cursor.close();
  return result;
}

function getDocumentInfo(doc: DocumentWithId) {
  const { _id, isNew, constructor } = doc;
  const { modelName } = constructor as Model<unknown>;
  return { _id, modelName, isNew };
}

function getQueryInfo(query: QueryExtras) {
  const { op, model: { modelName } } = query;
  return { op, modelName };
}

function getFindOneAndInfo(query: QueryExtras) {
  const { op, model: { modelName } } = query;
  const opts = query.getOptions();
  return {
    modelName,
    isUpdate: (op === 'findOneAndUpdate'),
    returnsNew: !!(
      opts.new
      || opts.returnOriginal === false
      || opts.returnDocument === 'after'
    ),
  };
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
      if (!isNew) {
        effect({ op: 'remove', modelName, ids: [_id] });
      }
      effect({ op: 'insert', modelName, docs: [this.toObject()] });
    }

    function preDocRemove(this: DocumentWithId) {
      const { _id, modelName } = getDocumentInfo(this);
      effect({ op: 'remove', modelName, ids: [_id] });
    }

    async function preQueryUpdate(this: QueryExtras) {
      const { op, modelName } = getQueryInfo(this);
      const ids = await findIds(this, op === 'updateOne');
      if (ids.length) {
        effect({ op: 'remove', modelName, ids });
        this.updatedIds = ids;
      }
    }

    async function postQueryUpdate(
      this: QueryExtras<UpdateWriteOpResult>,
      res: UpdateWriteOpResult,
    ) {
      const { model, updatedIds: ids = [] } = this;
      const { upsertedId } = res;
      if (upsertedId) ids.push(upsertedId as Types.ObjectId);
      if (ids && ids.length) {
        const updated = await model.find({ _id: { $in: ids } }).lean();
        effect({
          op: 'insert',
          modelName: model.modelName,
          docs: updated as HasObjectId[],
        });
      }
    }

    async function preQueryRemove(this: QueryExtras) {
      const { op, modelName } = getQueryInfo(this);
      const ids = await findIds(this, op === 'deleteOne');
      if (ids.length) {
        effect({ op: 'remove', modelName, ids });
      }
    }

    async function postFindOneAnd(this: QueryExtras<HasObjectId | null>, doc: HasObjectId | null) {
      if (!doc) return; // no match, do nothing
      const { modelName, isUpdate, returnsNew } = getFindOneAndInfo(this);
      // always effect remove event, for both remove and update queries
      effect({ op: 'remove', modelName, ids: [doc._id] });
      // send out insert event if we got an update
      if (isUpdate) {
        if (!returnsNew) {
          const { model } = this;
          doc = await model.findOne({ _id: doc._id }).lean();
          if (!doc) return; // might just have gotten deleted, exit
        }
        if (doc instanceof Document) doc = doc.toObject();
        effect({ op: 'insert', modelName, docs: [doc] });
      }
    }

    function preInsertMany(this: Model<unknown>, next: () => void, input: unknown) {
      // Unfortunately this middleware executes before the Documents are constructed,
      // meaning default value are missing. Create document only to pass to invalidation
      const { modelName } = this;
      const docs = (Array.isArray(input) ? input : [input])
        .map((item: unknown) => new this(item).toObject() as HasObjectId);
      effect({ op: 'insert', modelName, docs });
      next();
    }

    schema.pre(['save', 'updateOne'], DOCS, preDocSave);
    schema.pre(['remove', 'deleteOne'], DOCS, preDocRemove);
    schema.pre(['update', 'updateOne', 'updateMany'], QUERIES, preQueryUpdate);
    schema.post(['update', 'updateOne', 'updateMany'], QUERIES, postQueryUpdate);
    schema.pre(['remove', 'deleteOne', 'deleteMany'], QUERIES, preQueryRemove);
    schema.post(['findOneAndUpdate', 'findOneAndRemove', 'findOneAndDelete'], postFindOneAnd);
    schema.pre('insertMany', preInsertMany);
  };
}
