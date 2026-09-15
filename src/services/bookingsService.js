import { bookingsRepo } from '../repositories/bookingsRepo.js';
import { workPointsRepo } from '../repositories/workPointsRepo.js';
import { spacesRepo } from '../repositories/spacesRepo.js';
import { employeesRepo } from '../repositories/employeesRepo.js';
import { servicesRepo } from '../repositories/servicesRepo.js';
import { toolsRepo } from '../repositories/toolsRepo.js';
import { toolInstancesRepo } from '../repositories/toolInstancesRepo.js';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';
import { defaultPrice } from '../public/js/servicePrice.js';

const inactive = (b) => ['cancelled', 'no_show'].includes(b.status);
const cleanBooking = (b) => ({ ...b, status: b.status || 'waiting', warnings: [] });
const statuses = new Set(['waiting', 'arrived', 'cancelled', 'no_show']);
const overlaps = (a, b, c, d) => a < d && c < b;
const summary = (b) => ({ id: b.id, start: b.start, end: b.end, workPointId: b.workPointId,
  spaceId: b.spaceId, name: b.client?.name || 'Запись', href: `#bookings/${encodeURIComponent(b.id)}` });

async function validate(body, preview = false) {
  const status = body.status ?? 'waiting';
  if (!statuses.has(status)) throw new ValidationError('Неизвестный статус записи');
  const workPoint = body.workPointId ? await workPointsRepo.get(body.workPointId) : null;
  if (body.workPointId && !workPoint) throw new ValidationError('Рабочая точка не найдена');
  const spaceId = workPoint?.spaceId || body.spaceId;
  if (!spaceId || !(await spacesRepo.get(spaceId))) throw new ValidationError('Выберите пространство');
  if (workPoint && body.spaceId && body.spaceId !== spaceId) throw new ValidationError('Точка не принадлежит пространству');
  const start = Date.parse(body.start), end = Date.parse(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new ValidationError('Укажите дату и время');
  if (end - start < 5 * 60000) throw new ValidationError('Конец должен быть позже начала минимум на 5 минут');
  const serviceIds = [...new Set(Array.isArray(body.serviceIds) ? body.serviceIds : [])];
  const catalog = await servicesRepo.list();
  const byId = new Map(catalog.map((s) => [s.id, s]));
  if (!serviceIds.length) throw new ValidationError('Выберите хотя бы одну услугу');
  const services = serviceIds.map((id) => {
    if (!byId.has(id)) throw new ValidationError('Услуга не найдена');
    return byId.get(id);
  });
  const employeeIds = [...new Set(Array.isArray(body.employeeIds) ? body.employeeIds : [])];
  if (!preview) {
    if (!employeeIds.length) throw new ValidationError('Выберите исполнителя');
    for (const id of employeeIds) if (!(await employeesRepo.get(id))) throw new ValidationError('Сотрудник не найден');
  }
  const expanded = new Map();
  function visit(s) {
    if (!s || expanded.has(s.id)) return;
    expanded.set(s.id, s);
    for (const id of s.childServiceIds || []) visit(byId.get(id));
  }
  services.forEach(visit);
  const servicePrices = {};
  for (const [id, value] of Object.entries(body.servicePrices || {})) {
    const s = expanded.get(id);
    if (!s?.isComposite || s.compositeSum !== 'manual') throw new ValidationError('Цену можно менять только для услуги «Указать при записи»');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ValidationError('Некорректная цена услуги');
    servicePrices[id] = value;
  }
  const priced = new Map(byId);
  for (const [id, price] of Object.entries(servicePrices)) priced.set(id, { ...byId.get(id), compositeSum: 'fixed', price });
  let priceTotal = services.reduce((sum, s) => sum + defaultPrice(priced.get(s.id), priced), 0);
  // Preserve old explicitly overridden totals only on existing bookings.
  let priceOverride = null;
  if (body.priceOverride != null && body.priceOverride !== '') {
    priceOverride = Number(body.priceOverride);
    if (!Number.isFinite(priceOverride) || priceOverride < 0) throw new ValidationError('Некорректная сумма');
    priceTotal = priceOverride;
  }
  let client = null;
  if (body.client) {
    const type = body.client.type || (body.client.companyId ? 'company' : 'contact');
    const id = Number(body.client.id ?? body.client.contactId ?? body.client.companyId);
    if (!['contact', 'company'].includes(type) || !Number.isSafeInteger(id) || id <= 0) throw new ValidationError('Выберите клиента из списка CRM');
    client = { type, id, name: String(body.client.name || '').trim(), [type === 'contact' ? 'contactId' : 'companyId']: id };
  }
  return { status, workPointId: workPoint?.id || null, spaceId, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    employeeIds, serviceIds, servicePrices, priceOverride, priceTotal, client, note: String(body.note || '').trim() || null,
    expanded: [...expanded.values()] };
}

async function availability(v, excludeId) {
  const [all, instances, tools] = await Promise.all([bookingsRepo.list(), toolInstancesRepo.list(), toolsRepo.list()]);
  const overlapping = all.filter((b) => !inactive(b) && b.id !== excludeId && overlaps(Date.parse(v.start), Date.parse(v.end), Date.parse(b.start), Date.parse(b.end)));
  const conflicts = overlapping.filter((b) => b.spaceId === v.spaceId && (!v.workPointId || !b.workPointId || v.workPointId === b.workPointId)).map(summary);
  const staff = await employeesRepo.list();
  const identities = (ids) => new Set(ids.map((id) => {
    const e = staff.find((e) => e.id === id);
    return e?.b24UserId != null ? 'b24:' + e.b24UserId : id;
  }));
  const selected = identities(v.employeeIds);
  const employeeConflicts = overlapping.filter((b) => [...identities(b.employeeIds || [])].some((id) => selected.has(id))).map(summary);
  const needs = new Map();
  for (const s of v.expanded) for (const id of s.requiredToolIds || []) {
    needs.set(id, Math.max(needs.get(id) || 0, s.requiredToolCounts?.[id] ?? 1));
  }
  const busy = new Set(overlapping.flatMap((b) => b.toolInstanceIds || []));
  const assigned = [], warnings = [], requirements = [];
  for (const [toolId, required] of needs) {
    const pool = instances.filter((i) => i.toolId === toolId && i.spaceId === v.spaceId);
    const free = pool.filter((i) => !busy.has(i.id)).sort((a, b) => Number(b.spaceId === v.spaceId) - Number(a.spaceId === v.spaceId));
    const reservations = overlapping.filter((b) => pool.some((i) => (b.toolInstanceIds || []).includes(i.id))).map(summary);
    const row = { toolId, name: tools.find((t) => t.id === toolId)?.name || 'Инструмент', required,
      available: free.length, reserved: pool.length - free.length, total: pool.length, bookings: reservations };
    requirements.push(row);
    assigned.push(...free.slice(0, required).map((i) => i.id));
    if (free.length < required) warnings.push(`«${row.name}»: нужно ${required}, свободно ${free.length}, забронировано ${row.reserved}`);
  }
  return { conflicts: inactive(v) ? [] : conflicts, employeeConflicts: inactive(v) ? [] : employeeConflicts, requirements, warnings: inactive(v) || excludeId ? [] : warnings, toolInstanceIds: inactive(v) ? [] : assigned, priceTotal: v.priceTotal };
}

async function save(body, id) {
  const existing = id ? await bookingsRepo.get(id) : null;
  if (id && !existing) throw new NotFoundError('Запись не найдена');
  if (body.status != null && !statuses.has(body.status)) throw new ValidationError('Неизвестный статус записи');
  if (existing && inactive(body)) {
    const booking = await bookingsRepo.update(id, { status: body.status, toolInstanceIds: [], warnings: [] });
    return { booking: cleanBooking(booking), warnings: [], requirements: [], priceEstimated: false };
  }
  const v = await validate({ ...body, status: body.status ?? existing?.status ?? 'waiting' });
  const result = await availability(v, id);
  if (result.employeeConflicts.length) throw new ConflictError('Сотрудник уже занят в это время. Выберите другого исполнителя или время.');
  if (result.conflicts.length) throw new ConflictError('Выбранное время занято: измените время, пространство или рабочую точку');
  const { expanded, ...data } = v;
  const record = { ...data, toolInstanceIds: result.toolInstanceIds, warnings: [] };
  const booking = id ? await bookingsRepo.update(id, record) : await bookingsRepo.create(record);
  return { booking, warnings: [], requirements: result.requirements, priceEstimated: false };
}
// One process owns the JSON store. Serialize the check + reserve + save sequence.
let queue = Promise.resolve();
function mutate(fn) { const next = queue.then(fn); queue = next.catch(() => {}); return next; }
export const bookingsService = {
  async list({ from, to, workPointId, spaceId, employeeId, includeCancelled } = {}) {
    return (await bookingsRepo.list()).filter((b) => (includeCancelled === 'true' || b.status !== 'cancelled') && (!workPointId || b.workPointId === workPointId) && (!spaceId || b.spaceId === spaceId)
      && (!employeeId || (b.employeeIds || []).includes(employeeId))
      && (!from || Date.parse(b.end) > Date.parse(from)) && (!to || Date.parse(b.start) < Date.parse(to))).sort((a, b) => a.start.localeCompare(b.start)).map(cleanBooking);
  },
  async get(id) { const b = await bookingsRepo.get(id); if (!b) throw new NotFoundError('Запись не найдена'); return cleanBooking(b); },
  async preview(body) { return availability(await validate(body, true), body.excludeId); },
  create: (body) => mutate(() => save(body)),
  update: (id, body) => mutate(() => save(body, id)),
  remove: (id) => mutate(async () => { if (!(await bookingsRepo.remove(id))) throw new NotFoundError('Запись не найдена'); return { id }; }),
};
