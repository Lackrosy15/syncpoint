import { servicesRepo } from '../repositories/servicesRepo.js';
import { serviceCategoriesRepo } from '../repositories/serviceCategoriesRepo.js';
import { toolsRepo } from '../repositories/toolsRepo.js';
import { bookingsRepo } from '../repositories/bookingsRepo.js';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';

function cleanName(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ValidationError('Укажите название');
  }
  return name.trim();
}

function num(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`Некорректная цена: ${label}`);
  return n;
}

async function validateTools(requiredToolIds = []) {
  if (!Array.isArray(requiredToolIds)) throw new ValidationError('Некорректный список инструментов');
  for (const id of requiredToolIds) {
    if (!(await toolsRepo.get(id))) throw new ValidationError('Инструмент не найден');
  }
  return [...new Set(requiredToolIds)];
}

async function validateChildren(childServiceIds = [], selfId = null) {
  const ids = [...childServiceIds];
  for (const id of ids) {
    if (id === selfId) throw new ValidationError('Обнаружен цикл: услуга включает саму себя');
    if (!(await servicesRepo.get(id))) throw new ValidationError('Под-услуга не найдена');
  }
  if (selfId) await assertNoCycle(ids, selfId);
  return ids;
}

async function assertNoCycle(childIds, selfId) {
  const seen = new Set();
  const stack = [...childIds];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === selfId) throw new ValidationError('Обнаружен цикл во вложенных услугах');
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = await servicesRepo.get(cur);
    if (node?.isComposite) stack.push(...(node.childServiceIds || []));
  }
}

async function buildService(body, selfId = null) {
  const name = cleanName(body.name);
  const requiredToolIds = await validateTools(body.requiredToolIds);
  const counts = body.requiredToolCounts ?? {};
  if (typeof counts !== 'object' || Array.isArray(counts)) throw new ValidationError('Некорректное количество инструментов');
  const requiredToolCounts = {};
  for (const id of requiredToolIds) {
    const count = Object.hasOwn(counts, id) ? counts[id] : 1;
    if (!Number.isSafeInteger(count) || count < 1) throw new ValidationError('Количество инструмента должно быть целым числом от 1');
    requiredToolCounts[id] = count;
  }
  const isComposite = Boolean(body.isComposite);

  if (isComposite) {
    const compositeSum = body.compositeSum;
    if (!['auto', 'fixed', 'manual'].includes(compositeSum)) {
      throw new ValidationError('Укажите способ суммы составной услуги');
    }
    const childServiceIds = await validateChildren(body.childServiceIds, selfId);
    if (childServiceIds.length === 0) throw new ValidationError('Добавьте хотя бы одну под-услугу');
    return {
      name, isComposite: true, compositeSum, childServiceIds,
      priceType: null,
      price: compositeSum === 'fixed' ? num(body.price, 'фикс') : (compositeSum === 'manual' && body.price != null && body.price !== '' ? num(body.price, 'по умолчанию') : null),
      priceMin: null, priceMax: null,
      requiredToolIds, requiredToolCounts,
    };
  }

  const priceType = body.priceType;
  if (!['fixed', 'range', 'manual'].includes(priceType)) {
    throw new ValidationError('Укажите тип цены (фикс или диапазон)');
  }
  if (priceType === 'fixed' || priceType === 'manual') {
    return {
      name, isComposite: false, priceType,
      price: num(body.price, 'фикс'), priceMin: null, priceMax: null,
      compositeSum: null, childServiceIds: [], requiredToolIds, requiredToolCounts,
    };
  }
  const priceMin = num(body.priceMin, 'мин');
  const priceMax = num(body.priceMax, 'макс');
  if (priceMin > priceMax) throw new ValidationError('Минимум не может быть больше максимума');
  return {
    name, isComposite: false, priceType: 'range',
    price: null, priceMin, priceMax,
    compositeSum: null, childServiceIds: [], requiredToolIds, requiredToolCounts,
  };
}

export const servicesService = {
  list: () => servicesRepo.list(),
  async get(id) {
    const s = await servicesRepo.get(id);
    if (!s) throw new NotFoundError('Услуга не найдена');
    return s;
  },
  async create(body) {
    const categoryId = body.categoryId || null;
    if (categoryId && !(await serviceCategoriesRepo.get(categoryId))) throw new ValidationError('Категория не найдена');
    return servicesRepo.create({ ...await buildService(body, null), categoryId });
  },
  async update(id, body) {
    const existing = await servicesRepo.get(id);
    if (!existing) throw new NotFoundError('Услуга не найдена');
    const categoryId = body.categoryId === undefined ? (existing.categoryId ?? null) : (body.categoryId || null);
    if (categoryId && !(await serviceCategoriesRepo.get(categoryId))) throw new ValidationError('Категория не найдена');
    return servicesRepo.update(id, { ...await buildService(body, id), categoryId });
  },
  async remove(id) {
    const all = await servicesRepo.list();
    if (all.some((s) => s.id !== id && (s.childServiceIds || []).includes(id))) {
      throw new ConflictError('Нельзя удалить: услуга входит в составную услугу');
    }
    const bookings = await bookingsRepo.list();
    if (bookings.some((b) => (b.serviceIds || []).includes(id))) {
      throw new ConflictError('Нельзя удалить: услуга используется в записях');
    }
    const ok = await servicesRepo.remove(id);
    if (!ok) throw new NotFoundError('Услуга не найдена');
    return { id };
  },
};
