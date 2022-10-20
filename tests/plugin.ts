import { mondisTest } from './setup';

describe('Mongoose plugin middlewares', () => {
  mondisTest('Create document', async ({ models }) => {
    const { Vehicle } = models;
    const doc = new Vehicle({ kind: 'truck', price: 500 });
    await doc.save();
  });

  mondisTest('Create via model', async ({ models }) => {
    const { Vehicle } = models;
    await Vehicle.create({ kind: 'truck', price: 500 });
  });

  mondisTest('Insert many', async ({ models }) => {
    const { Vehicle } = models;
    await Vehicle.insertMany([
      { kind: 'car', price: 2400 },
      { kind: 'truck', price: 500 },
    ]);
  });

  mondisTest('Update document 1', async ({ models }) => {
    const { Vehicle } = models;
    const doc = await Vehicle.findOne({});
    if (!doc) throw Error('Document not found');
    doc.price = 5000;
    await doc.save();
  });

  mondisTest('Update document 2', async ({ models }) => {
    const { Vehicle } = models;
    const doc = await Vehicle.findOne({});
    if (!doc) throw Error('Document not found');
    await doc.updateOne({ price: 5000 });
  });

  mondisTest('Update query 1', async ({ models }) => {
    const { Vehicle } = models;
    await Vehicle.updateOne({}, { price: 5000 });
  });

  mondisTest('Update query 2', async ({ models }) => {
    const { Vehicle } = models;
    await Vehicle.updateOne({}, { $set: { price: 5000 } });
  });

  mondisTest('Update query 3', async ({ models }) => {
    const { Vehicle } = models;
    await Vehicle.updateMany({}, { $inc: { price: 5000 } });
  });

  mondisTest('Remove document', async ({ models }) => {
    const { Vehicle } = models;
    const doc = await Vehicle.findOne({});
    if (!doc) throw Error('Document not found');
    await doc.remove();
  });

  mondisTest('Remove query', async ({ models }) => {
    const { Vehicle } = models;
    await Vehicle.deleteOne({});
  });
});
