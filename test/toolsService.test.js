import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolsService } from '../src/services/toolsService.js';
import { spacesService } from '../src/services/spacesService.js';
import { spacesRepo } from '../src/repositories/spacesRepo.js';
import { toolsRepo } from '../src/repositories/toolsRepo.js';
import { toolInstancesRepo } from '../src/repositories/toolInstancesRepo.js';

let spaceA, spaceB;
beforeEach(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'sp-tools-'));
  spacesRepo._store._reset();
  toolsRepo._store._reset();
  toolInstancesRepo._store._reset();
  spaceA = await spacesService.create({ name: 'A' });
  spaceB = await spacesService.create({ name: 'B' });
});

test('createWithDistribution создаёт инструмент и экземпляры по пространствам', async () => {
  const { tool, instances } = await toolsService.createWithDistribution({
    name: 'Фен',
    distribution: [
      { spaceId: spaceA.id, count: 2 },
      { spaceId: spaceB.id, count: 4 },
    ],
  });
  assert.equal(tool.name, 'Фен');
  assert.equal(instances.length, 6);
  assert.equal(instances.filter((i) => i.spaceId === spaceA.id).length, 2);
  assert.equal(instances.filter((i) => i.spaceId === spaceB.id).length, 4);
  instances.forEach((i) => assert.equal(i.toolId, tool.id));
});

test('unassigned tools and instances are rejected before creation', async () => {
  await assert.rejects(toolsService.createWithDistribution({ name: 'Пылесос', distribution: [{ spaceId: null, count: 1 }] }), /пространство/i);
  await assert.rejects(toolsService.createWithDistribution({ name: 'Пылесос', distribution: [] }), /пространство/i);
  assert.equal((await toolsRepo.list()).length, 0);
});

test('распределение со ссылкой на несуществующее пространство — ValidationError', async () => {
  await assert.rejects(
    () => toolsService.createWithDistribution({ name: 'Х', distribution: [{ spaceId: 'нет', count: 1 }] }),
    /Пространство не найдено/,
  );
});

test('createWithDistribution без имени — ValidationError', async () => {
  await assert.rejects(
    () => toolsService.createWithDistribution({ name: '', distribution: [] }),
    /Укажите название/,
  );
});

test('addInstance добавляет один экземпляр существующему инструменту', async () => {
  const { tool } = await toolsService.createWithDistribution({ name: 'Фен', distribution: [{ spaceId: spaceA.id, count: 0 }] });
  const inst = await toolsService.addInstance({ toolId: tool.id, spaceId: spaceA.id });
  assert.equal(inst.toolId, tool.id);
  assert.equal(inst.spaceId, spaceA.id);
});

test('addInstance для несуществующего инструмента — ValidationError', async () => {
  await assert.rejects(
    () => toolsService.addInstance({ toolId: 'нет', spaceId: null }),
    /Инструмент не найден/,
  );
});

test('tool retains space with zero instances; null and fractional quantities rejected', async () => {
  const { tool } = await toolsService.createWithDistribution({ name: 'Фен', distribution: [{ spaceId: spaceA.id, count: 0 }] });
  assert.deepEqual(tool.spaceIds, [spaceA.id]);
  await assert.rejects(toolsService.addInstance({ toolId: tool.id }), /пространство/i);
  await assert.rejects(toolsService.createWithDistribution({ name: 'Фен', distribution: [{ spaceId: spaceA.id, count: 1.5 }] }), /целым/);
  const inst = await toolsService.addInstance({ toolId: tool.id, spaceId: spaceB.id });
  assert.ok((await toolsService.get(tool.id)).spaceIds.includes(spaceB.id));
  await assert.rejects(toolsService.updateInstance(inst.id, { spaceId: null }), /пространство/i);
});
