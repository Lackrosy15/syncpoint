import { bookingsRepo } from '../repositories/bookingsRepo.js';
import { employeesRepo } from '../repositories/employeesRepo.js';
import { servicesRepo } from '../repositories/servicesRepo.js';
import { ValidationError } from '../lib/errors.js';
import { serviceAmounts, serviceRule, effectivePercent } from './payrollRules.js';

export const payrollService = {
  async calc({ from, to, employeeId, includeWaiting } = {}) {
    const a = from ? Date.parse(from) : -Infinity, z = to ? Date.parse(to) : Infinity;
    if (Number.isNaN(a) || Number.isNaN(z) || a >= z) throw new ValidationError('Укажите корректный период расчёта');
    const [bookings, employees, services] = await Promise.all([bookingsRepo.list(), employeesRepo.list(), servicesRepo.list()]);
    const byId = new Map(employees.map((e) => [e.id, e]));
    const rows = new Map();
    for (const b of bookings) {
      if (['cancelled', 'no_show'].includes(b.status)) continue;
      if (Date.parse(b.start) < a || Date.parse(b.start) >= z) continue;
      const people = [...new Set(b.employeeIds || [])];
      const amounts = serviceAmounts(b, services);
      for (const id of people) {
        if (employeeId && employeeId !== id) continue;
        const e = byId.get(id); if (!e) continue;
        if (!rows.has(id)) rows.set(id, { employeeId: id, name: e.name, mode: e.salary?.mode || null, bookingsCount: 0, turnover: 0, amount: 0, details: [] });
        const row = rows.get(id), salary = e.salary || {};
        row.bookingsCount++; row.turnover += b.priceTotal || 0;
        const add = (serviceId, base, percent, participants, explicit) => {
          const amount = Math.round((base * percent / 100 + Number.EPSILON) * 100) / 100;
          row.amount += amount;
          row.details.push({ bookingId: b.id, start: b.start, client: b.client?.name || 'Без клиента', status: b.status || 'waiting', serviceId,
            serviceName: serviceId ? (services.find((s) => s.id === serviceId)?.name || 'Удалённая услуга') : 'Вся запись', base, percent, participants, explicit, amount });
        };
        if (salary.mode === 'flat') {
          const count = people.length;
          add(null, b.priceTotal || 0, effectivePercent(salary.flatPercent || 0, salary.teamPercents, count), count, count > 1 && salary.teamPercents?.[count] != null);
        } else if (salary.mode === 'perService') {
          for (const [sid, base] of Object.entries(amounts)) {
            const rule = serviceRule(salary, sid);
            const participants = people.filter((pid) => {
              const s = byId.get(pid)?.salary;
              const r = serviceRule(s, sid);
              return s?.mode === 'perService' && r.percent > 0;
            }).length;
            if (!participants || rule.percent <= 0) continue;
            add(sid, base, effectivePercent(rule.percent, rule.teamPercents, participants), participants, participants > 1 && rule.teamPercents[participants] != null);
          }
        }
      }
    }
    const result = [...rows.values()].map((r) => ({ ...r, turnover: Math.round(r.turnover * 100) / 100, amount: r.mode ? Math.round(r.amount * 100) / 100 : null })).sort((a,b) => a.name.localeCompare(b.name, 'ru'));
    return { from: from || null, to: to || null, rows: result, total: Math.round(result.reduce((sum,r) => sum + (r.amount || 0),0)*100)/100 };
  },
};
