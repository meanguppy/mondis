import type Mondis from '../../mondis';
import type { CacheEffect } from '../types';
import {
  collectInvalidations,
  buildInvalidationMaps,
  type InvalidationMaps,
  type CollectedInvalidations,
} from './core';

export default class InvalidationHandler {
  private invalidationMaps?: InvalidationMaps;
  readonly keysInvalidated: string[] = [];

  constructor(
    readonly context: Mondis,
  ) { }

  onCacheEffect(effect: CacheEffect) {
    switch (effect.op) {
      case 'insert': return this.doInsertInvalidation(effect);
      case 'update': return this.doUpdateInvalidation(effect);
      case 'remove': return this.doRemoveInvalidation(effect);
      default: return null;
    }
  }

  private async doUpdateInvalidation(effect: CacheEffect & { op: 'update' }) {
    const { modelName, modified, docs } = effect;
    const { primary, populated } = this.getInvalidationInfos(modelName);
    const targets = collectInvalidations((add) => {
      docs.forEach((doc) => {
        primary.forEach((info) => {
          add(info.getUpdateInvalidation(doc, modified));
        });
        populated.forEach((info) => {
          add(info.getUpdateInvalidation(doc, modified));
        });
      });
    });
    await this.doInvalidations(targets);
  }

  private async doInsertInvalidation(effect: CacheEffect & { op: 'insert' }) {
    const { modelName, docs } = effect;
    const { primary } = this.getInvalidationInfos(modelName);
    const targets = collectInvalidations((add) => {
      docs.forEach((doc) => {
        primary.forEach((info) => {
          add(info.getInsertInvalidation(doc));
        });
      });
    });
    await this.doInvalidations(targets);
  }

  private async doRemoveInvalidation(effect: CacheEffect & { op: 'remove' }) {
    const { ids } = effect;
    await this.doInvalidations({
      sets: ids.flatMap((id) => [
        { set: `O:${String(id)}` },
        { set: `P:${String(id)}` },
      ]),
    });
  }

  async doInvalidations(collected: CollectedInvalidations) {
    const { keys, sets } = collected;
    const promises: Promise<void>[] = [];
    if (keys && keys.length) {
      promises.push(...keys.map((key) => this.delQuery(key)));
    }
    if (sets && sets.length) {
      promises.push(...sets.map(({ set, filter }) => this.delQueriesIn(set, filter)));
    }
    await Promise.allSettled(promises);
  }

  private async delQuery(qkey: string) {
    const { redis } = this.context;
    const [[, docIds], [, populatedIds]] = await redis.multi()
      .hget(qkey, 'O')
      .hget(qkey, 'P')
      .del(qkey)
      .exec() as [[unknown, string | null], [unknown, string | null]];
    if (!docIds) return;
    this.keysInvalidated.push(qkey);
    const allKey = `A:${qkey.substring(2, 18)}`;
    const promises = [
      redis.srem(allKey, qkey),
    ];
    docIds.split(' ').forEach((id) => {
      promises.push(redis.srem(`O:${id}`, qkey));
    });
    populatedIds?.split(' ').forEach((id) => {
      promises.push(redis.srem(`P:${id}`, qkey));
    });
    await Promise.all(promises);
  }

  private async delQueriesIn(setKey: string, filter?: string) {
    const { redis } = this.context;
    let keys = await redis.smembers(setKey);
    if (filter) {
      keys = keys.filter((key) => key.startsWith(filter));
    }
    await Promise.all(keys.map((key) => this.delQuery(key)));
  }

  private getInvalidationInfos(model: string) {
    if (!this.invalidationMaps) {
      const queries = Object.values(this.context.queries);
      this.invalidationMaps = buildInvalidationMaps(queries);
    }
    return {
      primary: this.invalidationMaps.primary.get(model) ?? [],
      populated: this.invalidationMaps.populated.get(model) ?? [],
    };
  }
}
