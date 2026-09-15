import { bookingsRepo } from '../repositories/bookingsRepo.js';
import { employeesRepo } from '../repositories/employeesRepo.js';
import { servicesRepo } from '../repositories/servicesRepo.js';

// Цена услуги по умолчанию (range — по минимуму). Копия логики из bookingsService,
// чтобы начисление по perService не зависело от снимка priceTotal.
function defaultPrice(svc, byId) {
  if (!svc) return 0;
  if (svc.isComposite) {
    if (svc.compositeSum === 'fixed') return svc.price ?? 0;
    if (svc.compositeSum === 'auto') {
      return (svc.childServiceIds || []).reduce((sum, id) => sum + defaultPrice(byId.get(id), byId), 0);
    }
    return 0;
  }
  if (svc.priceType === 'fixed') return svc.price ?? 0;
  return svc.priceMin ?? 0;
}

// Начисление по одной записи для режима perService.
// Если задан priceOverride — распределяем его на услуги пропорционально их
// ценам по умолчанию; при нулевой базе — поровну.
function perServiceAmount(booking, servicePercents, svcById) {
  const percents = new Map(servicePercents.map((r) => [r.serviceId, r.percent]));
  const ids = booking.serviceIds || [];
  const defaults = ids.map((id) => defaultPrice(svcById.get(id), svcById));
  const baseTotal = defaults.reduce((a, b) => a + b, 0);

  let actual;
  if (booking.priceOverride != null) {
    if (baseTotal > 0) {
      actual = defaults.map((d) => (booking.priceOverride * d) / baseTotal);
    } else {
      actual = ids.map(() => booking.priceOverride / ids.length);
    }
  } else {
    actual = defaults;
  }

  return ids.reduce((sum, id, i) => {
    const p = percents.get(id);
    return p ? sum + (actual[i] * p) / 100 : sum;
  }, 0);
}

export const payrollService = {
  async calc({ from, to } = {}) {
    const fromMs = from ? Date.parse(from) : null;
    const toMs = to ? Date.parse(to) : null;

    const [bookings, employees, services] = await Promise.all([
      bookingsRepo.list(), employeesRepo.list(), servicesRepo.list(),
    ]);
    const svcById = new Map(services.map((s) => [s.id, s]));
    const empById = new Map(employees.map((e) => [e.id, e]));

    const inRange = bookings.filter((b) => {
      if (['cancelled', 'no_show'].includes(b.status)) return false;
      const s = Date.parse(b.start);
      if (Number.isFinite(fromMs) && Date.parse(b.end) <= fromMs) return false;
      if (Number.isFinite(toMs) && s >= toMs) return false;
      return true;
    });

    const acc = new Map(); // employeeId -> { bookingsCount, turnover, amount }
    for (const b of inRange) {
      const total = b.priceTotal ?? 0;
      for (const empId of b.employeeIds || []) {
        const emp = empById.get(empId);
        if (!emp) continue;
        if (!acc.has(empId)) acc.set(empId, { bookingsCount: 0, turnover: 0, amount: 0 });
        const row = acc.get(empId);
        row.bookingsCount += 1;
        row.turnover += total;

        const salary = emp.salary || {};
        if (salary.mode === 'flat') {
          row.amount += (total * (salary.flatPercent ?? 0)) / 100;
        } else if (salary.mode === 'perService') {
          row.amount += perServiceAmount(b, salary.servicePercents || [], svcById);
        }
        // mode = null → amount остаётся; ниже отметим как null
      }
    }

    const rows = [];
    for (const emp of employees) {
      const row = acc.get(emp.id);
      if (!row) continue; // не участвовал в записях периода — не показываем
      const mode = emp.salary?.mode ?? null;
      rows.push({
        employeeId: emp.id,
        name: emp.name,
        mode,
        bookingsCount: row.bookingsCount,
        turnover: Math.round(row.turnover * 100) / 100,
        amount: mode ? Math.round(row.amount * 100) / 100 : null,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { from: from ?? null, to: to ?? null, rows };
  },
};
