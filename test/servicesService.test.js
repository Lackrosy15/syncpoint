import { spacesRepo } from '../src/repositories/spacesRepo.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servicesService } from '../src/services/servicesService.js';
import { toolsService } from '../src/services/toolsService.js';
import { servicesRepo } from '../src/repositories/servicesRepo.js';
import { toolsRepo } from '../src/repositories/toolsRepo.js';
import { toolInstancesRepo } from '../src/repositories/toolInstancesRepo.js';

let tool;
beforeEach(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'sp-srv-'));
  servicesRepo._store._reset();
  toolsRepo._store._reset();
  toolInstancesRepo._store._reset();
  spacesRepo._store._reset();
  const space = await spacesRepo.create({ name: 'A' });
  tool = (await toolsService.createWithDistribution({ name: 'Фен', distribution: [{ spaceId: space.id, count: 0 }] })).tool;
});

test('tool quantities survive create and update, and unchecked tools are removed', async () => {
  const body = { name: 'Мойка', isComposite: false, priceType: 'fixed', price: 40,
    requiredToolIds: [tool.id], requiredToolCounts: { [tool.id]: 3 } };
  const service = await servicesService.create(body);
  assert.equal((await servicesService.get(service.id)).requiredToolCounts[tool.id], 3);
  await servicesService.update(service.id, { ...body, requiredToolCounts: { [tool.id]: 2 } });
  assert.equal((await servicesService.get(service.id)).requiredToolCounts[tool.id], 2);
  const cleared = await servicesService.update(service.id, { ...body, requiredToolIds: [] });
  assert.deepEqual(cleared.requiredToolCounts, {});
});

test('legacy tool selection defaults to one and invalid quantities are rejected', async () => {
  const body = { name: 'Мойка', priceType: 'fixed', price: 40, requiredToolIds: [tool.id] };
  assert.equal((await servicesService.create(body)).requiredToolCounts[tool.id], 1);
  for (const count of [0, -1, 1.5, '2', null]) {
    await assert.rejects(servicesService.create({ ...body, requiredToolCounts: { [tool.id]: count } }), /Количество/);
  }
});

test('простая услуга с фикс-ценой', async () => {
  const s = await servicesService.create({ name: 'Смыв', isComposite: false, priceType: 'fixed', price: 40 });
  assert.equal(s.price, 40);
  assert.equal(s.priceType, 'fixed');
  assert.equal(s.compositeSum, null);
  assert.deepEqual(s.childServiceIds, []);
});

test('простая услуга с диапазоном', async () => {
  const s = await servicesService.create({ name: 'Полир', isComposite: false, priceType: 'range', priceMin: 100, priceMax: 300 });
  assert.equal(s.priceMin, 100);
  assert.equal(s.priceMax, 300);
});

test('диапазон min>max — ValidationError', async () => {
  await assert.rejects(
    () => servicesService.create({ name: 'X', isComposite: false, priceType: 'range', priceMin: 300, priceMax: 100 }),
    /Минимум не может быть больше максимума/,
  );
});

test('составная auto не требует price', async () => {
  const a = await servicesService.create({ name: 'A', isComposite: false, priceType: 'fixed', price: 10 });
  const b = await servicesService.create({ name: 'B', isComposite: false, priceType: 'fixed', price: 20 });
  const c = await servicesService.create({ name: 'Комплекс', isComposite: true, compositeSum: 'auto', childServiceIds: [a.id, b.id] });
  assert.equal(c.compositeSum, 'auto');
  assert.equal(c.priceType, null);
  assert.deepEqual(c.childServiceIds, [a.id, b.id]);
});

test('составная ссылается на несуществующую под-услугу — ValidationError', async () => {
  await assert.rejects(
    () => servicesService.create({ name: 'K', isComposite: true, compositeSum: 'auto', childServiceIds: ['нет'] }),
    /Под-услуга не найдена/,
  );
});

test('запрет цикла: услуга не может включать саму себя через update', async () => {
  const a = await servicesService.create({ name: 'A', isComposite: false, priceType: 'fixed', price: 10 });
  const k = await servicesService.create({ name: 'K', isComposite: true, compositeSum: 'auto', childServiceIds: [a.id] });
  await assert.rejects(
    () => servicesService.update(k.id, { name: 'K', isComposite: true, compositeSum: 'auto', childServiceIds: [k.id] }),
    /цикл/i,
  );
});

test('requiredToolIds валидируется против существующих инструментов', async () => {
  const s = await servicesService.create({ name: 'Сушка', isComposite: false, priceType: 'fixed', price: 50, requiredToolIds: [tool.id] });
  assert.deepEqual(s.requiredToolIds, [tool.id]);
});

test('requiredToolIds с несуществующим инструментом — ValidationError', async () => {
  await assert.rejects(
    () => servicesService.create({ name: 'X', isComposite: false, priceType: 'fixed', price: 1, requiredToolIds: ['нет'] }),
    /Инструмент не найден/,
  );
});
