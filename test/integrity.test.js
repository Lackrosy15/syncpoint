import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spacesService } from '../src/services/spacesService.js';
import { workPointsService } from '../src/services/workPointsService.js';
import { toolsService } from '../src/services/toolsService.js';
import { servicesService } from '../src/services/servicesService.js';
import { spacesRepo } from '../src/repositories/spacesRepo.js';
import { workPointsRepo } from '../src/repositories/workPointsRepo.js';
import { toolsRepo } from '../src/repositories/toolsRepo.js';
import { toolInstancesRepo } from '../src/repositories/toolInstancesRepo.js';
import { servicesRepo } from '../src/repositories/servicesRepo.js';

beforeEach(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'sp-int-'));
  for (const r of [spacesRepo, workPointsRepo, toolsRepo, toolInstancesRepo, servicesRepo]) {
    r._store._reset();
  }
});

test('нельзя удалить пространство с рабочей точкой', async () => {
  const sp = await spacesService.create({ name: 'A' });
  await workPointsService.create({ name: 'Т', spaceId: sp.id });
  await assert.rejects(() => spacesService.remove(sp.id), (e) => e.status === 409);
});

test('нельзя удалить пространство с экземпляром инструмента', async () => {
  const sp = await spacesService.create({ name: 'A' });
  await toolsService.createWithDistribution({ name: 'Фен', distribution: [{ spaceId: sp.id, count: 1 }] });
  await assert.rejects(() => spacesService.remove(sp.id), (e) => e.status === 409);
});

test('пустое пространство удаляется', async () => {
  const sp = await spacesService.create({ name: 'A' });
  assert.deepEqual(await spacesService.remove(sp.id), { id: sp.id });
});

test('нельзя удалить инструмент с экземплярами', async () => {
  const { tool } = await toolsService.createWithDistribution({ name: 'Фен', distribution: [{ spaceId: (await spacesService.create({ name: 'A' })).id, count: 1 }] });
  await assert.rejects(() => toolsService.remove(tool.id), (e) => e.status === 409);
});

test('нельзя удалить инструмент, указанный в услуге', async () => {
  const { tool } = await toolsService.createWithDistribution({ name: 'Фен', distribution: [{ spaceId: (await spacesService.create({ name: 'A' })).id, count: 0 }] });
  await servicesService.create({ name: 'Сушка', isComposite: false, priceType: 'fixed', price: 10, requiredToolIds: [tool.id] });
  await assert.rejects(() => toolsService.remove(tool.id), (e) => e.status === 409);
});

test('нельзя удалить услугу, входящую в составную', async () => {
  const a = await servicesService.create({ name: 'A', isComposite: false, priceType: 'fixed', price: 10 });
  await servicesService.create({ name: 'K', isComposite: true, compositeSum: 'auto', childServiceIds: [a.id] });
  await assert.rejects(() => servicesService.remove(a.id), (e) => e.status === 409);
});
