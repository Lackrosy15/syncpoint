import { toolsRepo } from '../repositories/toolsRepo.js';
import { spacesRepo } from '../repositories/spacesRepo.js';
import { bookingsRepo } from '../repositories/bookingsRepo.js';
import { workPointsRepo } from '../repositories/workPointsRepo.js';
import { toolInstancesRepo } from '../repositories/toolInstancesRepo.js';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';

function cleanName(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ValidationError('Укажите название');
  }
  return name.trim();
}

export const spacesService = {
  list: () => spacesRepo.list(),
  async get(id) {
    const s = await spacesRepo.get(id);
    if (!s) throw new NotFoundError('Пространство не найдено');
    return s;
  },
  async create({ name }) { return spacesRepo.create({ name: cleanName(name) }); },
  async update(id, { name }) {
    const s = await spacesRepo.update(id, { name: cleanName(name) });
    if (!s) throw new NotFoundError('Пространство не найдено');
    return s;
  },
  async remove(id) {
    if ((await bookingsRepo.list()).some((b) => b.spaceId === id)) throw new ConflictError('Нельзя удалить: в пространстве есть записи');
    const wps = await workPointsRepo.list();
    if (wps.some((w) => w.spaceId === id)) {
      throw new ConflictError('Нельзя удалить: в пространстве есть рабочие точки');
    }
    const insts = await toolInstancesRepo.list();
    if (insts.some((i) => i.spaceId === id)) {
      throw new ConflictError('Нельзя удалить: в пространстве есть экземпляры инструментов');
    }
    if ((await toolsRepo.list()).some((t) => (t.spaceIds || []).includes(id))) throw new ConflictError('Нельзя удалить: к пространству привязан инструмент');
    const ok = await spacesRepo.remove(id);
    if (!ok) throw new NotFoundError('Пространство не найдено');
    return { id };
  },
};
