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

  private async doInvalidations(collected: CollectedInvalidations) {
    const { keys, sets } = collected;
    if ((!keys || !keys.length) && (!sets || !sets.length)) return;

    const pipeline = this.context.redis.pipeline();
    if (keys && keys.length) {
      keys.forEach((key) => pipeline.delQuery(key));
    }
    if (sets && sets.length) {
      sets.forEach(({ set, filter }) => pipeline.delQueriesIn(set, filter));
    }
    const result = await pipeline.exec();
    const { keysInvalidated } = this;
    result?.forEach(([err, res], idx) => {
      if (err) return;
      if (res === 1) {
        keysInvalidated.push(keys![idx]!);
      } else if (Array.isArray(res) && res.length) {
        keysInvalidated.push(...(res as string[]));
      }
    });
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
