import { el } from '../ui.js';
import { openBookingForm } from './bookingForm.js';

const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekOf = (date) => { const d = new Date(date); d.setDate(d.getDate() - (d.getDay() + 6) % 7); d.setHours(0, 0, 0, 0); return d; };
const time = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function calendarView(mount, api) {
  const root = el('div', { class: 'records-calendar' });
  mount.append(root);
  const state = { week: weekOf(new Date()), spaceId: '', pointId: '', employeeId: '', active: true, version: 0, scroll: 8 * 60 };
  const refresh = async () => {
    const version = ++state.version;
    const oldScroll = root.querySelector('.records-scroll');
    if (oldScroll) { state.scroll = oldScroll.scrollTop; state.scrollLeft = oldScroll.scrollLeft; }
    try {
      const end = new Date(state.week); end.setDate(end.getDate() + 7);
      const query = new URLSearchParams({ from: state.week.toISOString(), to: end.toISOString(), spaceId: state.spaceId, workPointId: state.pointId, employeeId: state.employeeId });
      const [bookings, spaces, points, services, employees] = await Promise.all([
        api.get(`bookings?${query}`), api.list('spaces'), api.list('work-points'), api.list('services'), api.list('employees'),
      ]);
      if (!state.active || version !== state.version) return;
      const open = (options = {}) => openBookingForm(api, { spaceId: state.spaceId, workPointId: state.pointId, ...options }, refresh);
      const spaceSelect = el('select', { 'aria-label': 'Фильтр пространства' }, [el('option', { value: '' }, 'Все пространства'), ...spaces.map((s) => el('option', { value: s.id }, s.name))]);
      spaceSelect.value = state.spaceId;
      spaceSelect.onchange = () => { state.spaceId = spaceSelect.value; state.pointId = ''; refresh(); };
      const pointSelect = el('select', { 'aria-label': 'Фильтр рабочей точки' }, [el('option', { value: '' }, 'Все рабочие точки'), ...points.filter((p) => !state.spaceId || p.spaceId === state.spaceId).map((p) => el('option', { value: p.id }, p.name))]);
      pointSelect.value = state.pointId; pointSelect.onchange = () => { state.pointId = pointSelect.value; refresh(); };
      const employeeSelect = el('select', { 'aria-label': 'Фильтр сотрудника' }, [el('option', { value: '' }, 'Все сотрудники'), ...employees.map((e) => el('option', { value: e.id }, e.name + (e.source === 'manual' ? ' — Внештатный сотрудник' : '')))]);
      employeeSelect.value = state.employeeId; employeeSelect.onchange = () => { state.employeeId = employeeSelect.value; refresh(); };
      const shift = (days) => { state.week.setDate(state.week.getDate() + days); refresh(); };
      const picker = monthPicker(state.week, (date) => { state.week = weekOf(date); refresh(); });
      const last = new Date(end); last.setDate(last.getDate() - 1);
      const header = el('div', { class: 'records-toolbar' }, [
        el('button', { class: 'btn', onclick: () => open() }, 'Создать запись'),
        el('button', { class: 'btn secondary', 'aria-label': 'Предыдущая неделя', onclick: () => shift(-7) }, '‹'),
        el('b', {}, `${state.week.toLocaleDateString('ru-RU')} — ${last.toLocaleDateString('ru-RU')}`),
        el('button', { class: 'btn secondary', 'aria-label': 'Следующая неделя', onclick: () => shift(7) }, '›'), picker, spaceSelect, pointSelect, employeeSelect,
        el('span', { class: 'muted records-status' }, `Обновлено ${time(new Date())} · каждые 15 сек.`),
      ]);
      const grid = el('div', { class: 'records-week' });
      grid.append(el('div', { class: 'records-day-title' }, 'Время'));
      const days = Array.from({ length: 7 }, (_, n) => { const d = new Date(state.week); d.setDate(d.getDate() + n); return d; });
      for (const d of days) grid.append(el('div', { class: `records-day-title ${localDate(d) === localDate(new Date()) ? 'is-today' : ''}` }, d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })));
      const axis = el('div', { class: 'records-axis' });
      for (let h = 0; h < 24; h++) axis.append(el('span', { style: `top:${h * 60}px` }, `${pad(h)}:00`));
      grid.append(axis);
      const eventLayouts = [], dayWidths = [];
      for (const d of days) {
        const next = new Date(d); next.setDate(next.getDate() + 1);
        const col = el('div', { class: 'records-day', 'aria-label': d.toLocaleDateString('ru-RU') });
        for (let h = 0; h < 48; h++) col.append(el('button', { class: 'records-slot', style: `top:${h * 30}px`, 'aria-label': `Создать запись ${localDate(d)} ${pad(Math.floor(h / 2))}:${h % 2 ? '30' : '00'}`, onclick: () => {
          const start = new Date(d); start.setHours(Math.floor(h / 2), h % 2 * 30); open({ date: start });
        } }));
        const events = bookings.filter((b) => Date.parse(b.start) < next.getTime() && Date.parse(b.end) > d.getTime()).sort((a, b) => a.start.localeCompare(b.start));
        const groups = []; let group = [], groupEnd = 0;
        for (const b of events) {
          if (group.length && Date.parse(b.start) >= groupEnd) { groups.push(group); group = []; }
          group.push(b); groupEnd = Math.max(group.length === 1 ? 0 : groupEnd, Date.parse(b.end));
        }
        if (group.length) groups.push(group);
        let maxLanes = 1;
        for (const group of groups) {
          const lanes = [], placed = [];
          for (const b of group) {
            let lane = lanes.findIndex((end) => end <= Date.parse(b.start));
            if (lane < 0) lane = lanes.length;
            lanes[lane] = Date.parse(b.end); placed.push({ b, lane });
          }
          maxLanes = Math.max(maxLanes, lanes.length);
          for (const { b, lane } of placed) {
            const startDate = new Date(Math.max(Date.parse(b.start), d.getTime()));
            const endDate = new Date(Math.min(Date.parse(b.end), next.getTime()));
            const top = startDate.getHours() * 60 + startDate.getMinutes();
            const bottom = endDate.getTime() === next.getTime() ? 1440 : endDate.getHours() * 60 + endDate.getMinutes();
            const names = (b.serviceIds || []).map((id) => services.find((s) => s.id === id)?.name || 'Услуга').join(', ');
            const place = points.find((p) => p.id === b.workPointId)?.name || spaces.find((s) => s.id === b.spaceId)?.name || 'Без точки';
            const staff = (b.employeeIds || []).map((id) => employees.find((e) => e.id === id)?.name || 'Сотрудник недоступен').join(', ') || 'Не назначены';
            const card = el('button', { class: `records-event records-event-${b.status || 'waiting'}`, title: `${names}\n${place}\n${b.client?.name || 'Без клиента'}${b.note ? '\nЗаметка: ' + b.note : ''}`, style: `top:${top}px;height:${Math.max(22, bottom - top)}px;left:${lane * 100 / lanes.length}%;width:${100 / lanes.length}%`, onclick: () => open({ booking: b }) }, [
              el('b', {}, `${time(b.start)}–${time(b.end)}`), el('span', {}, names), el('span', { class: 'records-person' }, [el('strong', {}, 'Клиент: '), b.client?.name || 'Не указан']),
              el('span', { class: 'records-person' }, [el('strong', {}, 'Исполнители: '), staff]), el('span', { class: 'records-place' }, place),
              el('span', {}, ({ waiting: 'Ожидание', arrived: 'Пришёл', no_show: 'Не пришёл' })[b.status || 'waiting']),
            ]);
            col.append(card); eventLayouts.push({ card, top, bottom });
          }
        }
        if (localDate(d) === localDate(new Date())) {
          const now = new Date(); col.append(el('div', { class: 'records-now', style: `top:${now.getHours() * 60 + now.getMinutes()}px` }));
        }
        dayWidths.push(Math.max(220, maxLanes * 180));
        grid.append(col);
      }
      grid.style.gridTemplateColumns = `60px ${dayWidths.map((w) => `minmax(${w}px, 1fr)`).join(' ')}`;
      const scroll = el('div', { class: 'records-scroll' }, grid);
      root.replaceChildren(header, scroll);
      // Expand shared time rows so full names fit without obscuring adjacent events.
      const boundaries = [...new Set([...Array.from({ length: 49 }, (_, i) => i * 30), ...eventLayouts.flatMap(({ top, bottom }) => [top, bottom])])].sort((a, b) => a - b);
      const heights = boundaries.slice(1).map((end, i) => end - boundaries[i]);
      const position = (minute) => heights.reduce((sum, height, i) => sum + height * Math.max(0, Math.min(1, (minute - boundaries[i]) / (boundaries[i + 1] - boundaries[i]))), 0);
      for (const { card, top, bottom } of eventLayouts) {
        card.style.height = 'auto';
        const needed = card.getBoundingClientRect().height + 4;
        const available = position(bottom) - position(top);
        if (available > 0 && needed > available) {
          const factor = needed / available;
          for (let i = 0; i < heights.length; i++) if (boundaries[i] < bottom && boundaries[i + 1] > top) heights[i] *= factor;
        }
      }
      for (const { card, top, bottom } of eventLayouts) {
        card.style.top = position(top) + 'px'; card.style.height = (position(bottom) - position(top)) + 'px';
      }
      for (const col of grid.querySelectorAll('.records-day, .records-axis')) col.style.height = position(1440) + 'px';
      grid.querySelectorAll('.records-axis span').forEach((label, h) => { label.style.top = position(h * 60) + 'px'; });
      for (const col of grid.querySelectorAll('.records-day')) {
        col.querySelectorAll('.records-slot').forEach((slot, i) => { slot.style.top = position(i * 30) + 'px'; slot.style.height = (position((i + 1) * 30) - position(i * 30)) + 'px'; });
        const line = col.querySelector('.records-now');
        if (line) { const now = new Date(); line.style.top = position(now.getHours() * 60 + now.getMinutes()) + 'px'; }
      }
      scroll.scrollTop = state.scroll; scroll.scrollLeft = state.scrollLeft || 0;
    } catch (e) {
      if (state.active && version === state.version) {
        root.querySelector('.records-load-error')?.remove();
        root.prepend(el('div', { class: 'banner records-load-error' }, `Не удалось обновить календарь: ${e.message}`));
      }
    }
  };
  refresh();
  const id = decodeURIComponent(location.hash.match(/^#bookings\/(.+)$/)?.[1] || '');
  if (id) api.get(`bookings/${encodeURIComponent(id)}`).then((booking) => {
    if (state.active) { state.week = weekOf(new Date(booking.start)); state.scroll = Math.max(0, new Date(booking.start).getHours() * 60 - 60); refresh(); openBookingForm(api, { booking }, refresh); }
  }).catch((e) => { if (state.active) root.prepend(el('div', { class: 'banner' }, e.message)); });
  const timer = setInterval(() => {
    if (!document.hidden && !root.querySelector('details[open]') && !root.contains(document.activeElement)) refresh();
  }, 15000);
  return () => { state.active = false; clearInterval(timer); };
}

function monthPicker(initial, select) {
  const details = el('details', { class: 'records-date-picker' });
  const pane = el('div', { class: 'records-month' });
  let cursor = new Date(initial.getFullYear(), initial.getMonth(), 1);
  const draw = () => {
    const month = el('select', { 'aria-label': 'Месяц' }, Array.from({ length: 12 }, (_, i) => el('option', { value: i }, new Date(2026, i, 1).toLocaleDateString('ru-RU', { month: 'long' }))));
    month.value = cursor.getMonth();
    const year = el('input', { type: 'number', value: cursor.getFullYear(), min: '1900', max: '2200', 'aria-label': 'Год' });
    month.onchange = () => { cursor.setMonth(Number(month.value)); draw(); };
    year.onchange = () => { const y = Number(year.value); if (y >= 1900 && y <= 2200) { cursor.setFullYear(y); draw(); } };
    const shift = (n) => { cursor.setMonth(cursor.getMonth() + n); draw(); };
    const dates = el('div', { class: 'records-month-days' });
    for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) dates.append(el('span', {}, day));
    const start = weekOf(cursor);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      dates.append(el('button', { class: `${d.getMonth() !== cursor.getMonth() ? 'outside' : ''} ${localDate(d) === localDate(new Date()) ? 'is-today' : ''}`, onclick: () => select(d) }, d.getDate()));
    }
    pane.replaceChildren(el('div', { class: 'records-month-nav' }, [el('button', { onclick: () => shift(-1), 'aria-label': 'Предыдущий месяц' }, '‹'), month, year,
      el('button', { onclick: () => shift(1), 'aria-label': 'Следующий месяц' }, '›')]), dates);
  };
  draw(); details.append(el('summary', {}, 'Месяц / год'), pane); return details;
}
