import { mondisTest } from './setup';

describe('Rehydrate CachedQueries', () => {
  mondisTest('does not rehydrate if nothing was cached', async ({ mondis, models }) => {
    const { Static1 } = mondis.queries;
    const { Vehicle } = models;
    await Vehicle.create({ kind: 'car', price: 2500 });
    const rehydrateSpy = jest.spyOn(mondis.rehydrator, 'rehydrate');
    const execSpy = jest.spyOn(Static1, 'exec');
    await mondis.rehydrate();
    expect(rehydrateSpy).toBeCalledWith([]);
    expect(execSpy).not.toBeCalled();
  });

  mondisTest('does not rehydrate if nothing was changed', async ({ mondis }) => {
    const { Static1 } = mondis.queries;
    await Static1.exec();
    const rehydrateSpy = jest.spyOn(mondis.rehydrator, 'rehydrate');
    const execSpy = jest.spyOn(Static1, 'exec');
    await mondis.rehydrate();
    expect(rehydrateSpy).toBeCalledWith([]);
    expect(execSpy).not.toBeCalled();
  });

  mondisTest('does not rehydrate if explicitly disabled', async ({ mondis, models }) => {
    const { Static1 } = mondis.queries;
    const { Vehicle } = models;
    await Static1.exec();
    await Vehicle.create({ kind: 'car', price: 2500 });
    const execSpy = jest.spyOn(Static1, 'exec');
    await mondis.rehydrate();
    expect(execSpy).not.toBeCalled();
  }, { rehydrate: false });

  mondisTest('will rehydrate if there was a change', async ({ mondis, models }) => {
    const { Static1 } = mondis.queries;
    const { Vehicle } = models;
    await Static1.exec();
    await Vehicle.create({ kind: 'car', price: 2500 });
    const rehydrateSpy = jest.spyOn(mondis.rehydrator, 'rehydrate');
    const execSpy = jest.spyOn(Static1, 'exec');
    await mondis.rehydrate();
    expect(rehydrateSpy).toBeCalledWith([Static1.getCacheKey([])]);
    expect(execSpy).toBeCalled();
  });
});
