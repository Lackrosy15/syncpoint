import { toolsRepo } from '../repositories/toolsRepo.js';
import { toolInstancesRepo } from '../repositories/toolInstancesRepo.js';
import { spacesRepo } from '../repositories/spacesRepo.js';
import { servicesRepo } from '../repositories/servicesRepo.js';
import { bookingsRepo } from '../repositories/bookingsRepo.js';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';

function cleanName(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ValidationError('Укажите название');
  }
  return name.trim();
}

async function requireSpaceOrNull(spaceId) {
  if (!spaceId) throw new ValidationError('Выберите пространство');
  if (!(await spacesRepo.get(spaceId))) throw new ValidationError('Пространство не найдено');
  return spaceId;
}

async function requireTool(toolId) {
  const t = await toolsRepo.get(toolId);
  if (!t) throw new ValidationError('Инструмент не найден');
  return t;
}

export const toolsService = {
  list: () => toolsRepo.list(),
  async get(id) {
    const t = await toolsRepo.get(id);
    if (!t) throw new NotFoundError('Инструмент не найден');
    return t;
  },
  async create({ name, spaceId }) { const id = await requireSpaceOrNull(spaceId); return toolsRepo.create({ name: cleanName(name), spaceIds: [id] }); },
  async createWithDistribution({ name, distribution = [] }) {
    const n = cleanName(name);
    if (!Array.isArray(distribution) || !distribution.length) throw new ValidationError('Выберите пространство инструмента');
    const normalized = [];
    for (const row of distribution) {
      const spaceId = await requireSpaceOrNull(row.spaceId ?? null);
      const count = Number(row.count);
      if (!Number.isSafeInteger(count) || count < 0) throw new ValidationError('Количество должно быть целым числом от 0');
      normalized.push({ spaceId, count });
    }
    const tool = await toolsRepo.create({ name: n, spaceIds: [...new Set(normalized.map((r) => r.spaceId))] });
    const instances = [];
    for (const { spaceId, count } of normalized) {
      for (let i = 0; i < count; i++) {
        instances.push(await toolInstancesRepo.create({ toolId: tool.id, spaceId, label: null }));
      }
    }
    return { tool, instances };
  },
  async update(id, { name, spaceIds }) {
    const existing = await requireTool(id);
    const instances = (await toolInstancesRepo.list()).filter((i) => i.toolId === id);
    const ids = [...new Set(spaceIds ?? [...(existing.spaceIds || []), ...instances.map((i) => i.spaceId).filter(Boolean)])];
    if (!ids.length) throw new ValidationError('Выберите пространство инструмента');
    for (const sid of ids) await requireSpaceOrNull(sid);
    if (instances.some((i) => i.spaceId && !ids.includes(i.spaceId))) throw new ConflictError('Сначала переместите или удалите экземпляры этого пространства');
    const t = await toolsRepo.update(id, { name: cleanName(name), spaceIds: ids });
    if (!t) throw new NotFoundError('Инструмент не найден');
    return t;
  },
  async remove(id) {
    const insts = await toolInstancesRepo.list();
    if (insts.some((i) => i.toolId === id)) {
      throw new ConflictError('Нельзя удалить: у инструмента есть экземпляры');
    }
    const services = await servicesRepo.list();
    if (services.some((s) => (s.requiredToolIds || []).includes(id))) {
      throw new ConflictError('Нельзя удалить: инструмент указан в услуге');
    }
    const ok = await toolsRepo.remove(id);
    if (!ok) throw new NotFoundError('Инструмент не найден');
    return { id };
  },

  listInstances: () => toolInstancesRepo.list(),
  async addInstance({ toolId, spaceId = null, label = null }) {
    const tool = await requireTool(toolId);
    const s = await requireSpaceOrNull(spaceId);
    await toolsRepo.update(toolId, { spaceIds: [...new Set([...(tool.spaceIds || []), s])] });
    return toolInstancesRepo.create({ toolId, spaceId: s, label });
  },
  async updateInstance(id, { spaceId, label }) {
    const s = await requireSpaceOrNull(spaceId ?? null);
    const old = await toolInstancesRepo.get(id);
    if (!old) throw new NotFoundError('Экземпляр не найден');
    if (old.spaceId !== s && (await bookingsRepo.list()).some((b) => !['cancelled', 'no_show'].includes(b.status) && Date.parse(b.end) > Date.now() && (b.toolInstanceIds || []).includes(id))) throw new ConflictError('Экземпляр забронирован: сначала перенесите запись');
    const tool = await requireTool(old.toolId);
    await toolsRepo.update(tool.id, { spaceIds: [...new Set([...(tool.spaceIds || []), s])] });
    const inst = await toolInstancesRepo.update(id, { spaceId: s, label: label ?? null });
    if (!inst) throw new NotFoundError('Экземпляр не найден');
    return inst;
  },
  async removeInstance(id) {
    const bookings = await bookingsRepo.list();
    if (bookings.some((b) => (b.toolInstanceIds || []).includes(id))) {
      throw new ConflictError('Нельзя удалить: экземпляр забронирован в записях');
    }
    const ok = await toolInstancesRepo.remove(id);
    if (!ok) throw new NotFoundError('Экземпляр не найден');
    return { id };
  },
};
