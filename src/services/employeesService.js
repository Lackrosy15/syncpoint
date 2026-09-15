import { employeesRepo } from '../repositories/employeesRepo.js';
import { servicesRepo } from '../repositories/servicesRepo.js';
import { bookingsRepo } from '../repositories/bookingsRepo.js';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';

const emptySalary = () => ({ mode: null, flatPercent: null, servicePercents: [] });

function cleanName(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ValidationError('Укажите имя');
  }
  return name.trim();
}

export const employeesService = {
  list: () => employeesRepo.list(),
  async get(id) {
    const e = await employeesRepo.get(id);
    if (!e) throw new NotFoundError('Сотрудник не найден');
    return e;
  },
  async addManual({ name }) {
    return employeesRepo.create({
      name: cleanName(name),
      source: 'manual',
      b24UserId: null,
      salary: emptySalary(),
    });
  },
  async importFromB24(users = []) {
    const existing = await employeesRepo.list();
    const known = new Set(existing.filter((e) => e.b24UserId != null).map((e) => e.b24UserId));
    const created = [];
    for (const u of users) {
      const b24UserId = Number(u.id);
      if (known.has(b24UserId)) continue;
      known.add(b24UserId);
      created.push(await employeesRepo.create({
        name: cleanName(u.name),
        source: 'b24',
        b24UserId,
        salary: emptySalary(),
      }));
    }
    return created;
  },
  async update(id, { name }) {
    const e = await employeesRepo.update(id, { name: cleanName(name) });
    if (!e) throw new NotFoundError('Сотрудник не найден');
    return e;
  },
  async updateSalary(id, { mode, flatPercent, defaultServicePercent, teamPercents, servicePercents }) {
    if (!(await employeesRepo.get(id))) throw new NotFoundError('Сотрудник не найден');
    const percent = (value) => {
      if (value === '' || value == null || typeof value === 'boolean') throw new ValidationError('Укажите процент от 0 до 100');
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError('Процент должен быть от 0 до 100');
      return n;
    };
    const team = (values = {}) => {
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ValidationError('Некорректные проценты команды');
      const result = {};
      for (const [count, value] of Object.entries(values)) {
        if (!['2','3','4','5'].includes(count)) throw new ValidationError('Размер команды должен быть от 2 до 5');
        if (value != null && value !== '') result[count] = percent(value);
      }
      return result;
    };
    let salary;
    if (mode === 'flat') salary = { mode, flatPercent: percent(flatPercent), teamPercents: team(teamPercents), servicePercents: [] };
    else if (mode === 'perService') {
      if (servicePercents != null && !Array.isArray(servicePercents)) throw new ValidationError('Некорректный список услуг');
      const rules = [], seen = new Set();
      for (const r of servicePercents || []) {
        if (!r.serviceId || seen.has(r.serviceId) || !(await servicesRepo.get(r.serviceId))) throw new ValidationError('Услуга отсутствует или повторяется');
        seen.add(r.serviceId); rules.push({ serviceId: r.serviceId, percent: percent(r.percent), teamPercents: team(r.teamPercents) });
      }
      salary = { mode, defaultServicePercent: percent(defaultServicePercent ?? 0), teamPercents: team(teamPercents), servicePercents: rules };
    } else if (!mode) salary = emptySalary();
    else throw new ValidationError('Неизвестный режим ЗП');
    return employeesRepo.update(id, { salary });
  },
  async remove(id) {
    const bookings = await bookingsRepo.list();
    if (bookings.some((b) => (b.employeeIds || []).includes(id))) {
      throw new ConflictError('Нельзя удалить: сотрудник участвует в записях');
    }
    const ok = await employeesRepo.remove(id);
    if (!ok) throw new NotFoundError('Сотрудник не найден');
    return { id };
  },
};
