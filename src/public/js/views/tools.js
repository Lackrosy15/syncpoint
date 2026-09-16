import { canEdit } from '../access.js';
import { el, textField, openModal } from '../ui.js';

export function toolsView(mount, api) {
  render(mount, api);
}

async function render(mount, api) {
  mount.innerHTML = '';
  if (canEdit('tools')) mount.append(el('div', { class: 'toolbar' }, [
    el('button', { class: 'btn', onclick: () => openCreate(mount, api) }, 'Добавить инструмент'),
  ]));

  let tools = [], instances = [], spaces = [];
  try {
    [tools, instances, spaces] = await Promise.all([
      api.list('tools'), api.list('tool-instances'), api.list('spaces'),
    ]);
  } catch (e) { mount.append(el('div', { class: 'banner' }, e.message)); }

  const spaceName = (id) => (id == null ? 'Требуется назначить пространство' : (spaces.find((s) => s.id === id)?.name || '—'));

  if (!tools.length) mount.append(el('div', { class: 'muted' }, 'Пока пусто.'));
  for (const tool of tools) {
    const own = instances.filter((i) => i.toolId === tool.id);

    // Группировка по пространству: «Автомойка 1 — 9» вместо списка строк.
    const groups = new Map(); // key: spaceId или 'null'
    for (const inst of own) {
      const key = inst.spaceId == null ? 'null' : inst.spaceId;
      if (!groups.has(key)) groups.set(key, { spaceId: inst.spaceId, items: [] });
      groups.get(key).items.push(inst);
    }

    for (const id of tool.spaceIds || []) if (!groups.has(id)) groups.set(id, { spaceId: id, items: [] });
    const groupRows = [...groups.values()].map((g) => {
      const named = g.items.filter((i) => i.label);
      return el('div', { class: 'meta', style: 'display:flex;align-items:center;gap:8px;padding:2px 0' }, [
        el('span', { style: 'flex:1' }, `${spaceName(g.spaceId)} — ${g.items.length}`),
        canEdit('tools') ? el('button', { class: 'btn link', onclick: () => editGroup(tool, g, spaces, mount, api) }, '✎ кол-во') : null,
        ...g.items.filter(() => canEdit('tools')).filter((i) => i.label || !g.spaceId).map((i) => el('button', {
          class: 'btn link', title: `Переименовать «${i.label}»`,
          onclick: () => editInstance(i, spaces, mount, api),
        }, `${i.label || 'Назначить пространство'} ✎`)),
      ]);
    });

    mount.append(el('div', { class: 'row' }, [
      el('div', {}, [
        el('b', {}, tool.name),
        el('div', { class: 'meta' }, `Экземпляров: ${own.length}`),
        ...groupRows,
      ]),
      canEdit('tools') ? el('div', {}, [
        el('button', { class: 'btn link', onclick: () => openEdit(tool, own, spaces, mount, api) }, 'Изменить'),
        el('button', { class: 'btn link', onclick: () => del(tool, mount, api) }, 'Удалить'),
      ]) : null,
    ]));
  }
}

// Изменить количество экземпляров пространства: добавляет недостающие или
// удаляет лишние (сначала безымянные), чтобы итог равнялся заданному числу.
function editGroup(tool, group, spaces, mount, api) {
  const count = el('input', { type: 'number', min: '0', value: String(group.items.length) });
  const name = group.spaceId == null ? 'Без пространства'
    : (spaces.find((s) => s.id === group.spaceId)?.name || '—');
  openModal({
    title: `${tool.name}: ${name}`,
    body: el('div', { class: 'field' }, [el('label', {}, 'Количество экземпляров'), count]),
    onSubmit: async () => {
      const target = Number(count.value);
      if (!Number.isInteger(target) || target < 0) throw new Error('Укажите целое число от 0');
      const cur = group.items.length;
      if (target > cur) {
        for (let i = 0; i < target - cur; i++) {
          await api.create('tool-instances', { toolId: tool.id, spaceId: group.spaceId ?? null });
        }
      } else if (target < cur) {
        // Удаляем сначала безымянные, чтобы не сносить подписанные экземпляры.
        const sorted = [...group.items].sort((a, b) => (a.label ? 1 : 0) - (b.label ? 1 : 0));
        for (const inst of sorted.slice(0, cur - target)) {
          await api.remove('tool-instances', inst.id);
        }
      }
      await render(mount, api);
    },
  });
}

// Редактирование экземпляра: название (label) и пространство.
function editInstance(inst, spaces, mount, api) {
  const label = textField('Название экземпляра', inst.label || '');
  const sel = el('select', {});
  sel.append(el('option', { value: '' }, 'Выберите пространство'));
  for (const s of spaces) {
    const opt = el('option', { value: s.id }, s.name);
    if (inst.spaceId === s.id) opt.selected = true;
    sel.append(opt);
  }
  openModal({
    title: 'Экземпляр',
    body: el('div', {}, [
      label.field,
      el('div', { class: 'field' }, [el('label', {}, 'Пространство'), sel]),
    ]),
    onSubmit: async () => {
      await api.update('tool-instances', inst.id, {
        label: label.input.value.trim() || null,
        spaceId: sel.value || null,
      });
      await render(mount, api);
    },
  });
}

function openEdit(tool, instances, spaces, mount, api) {
  const name = textField('Название инструмента', tool.name);
  const rowsWrap = el('div', {});
  const rows = [];
  let saving = false;
  const groups = new Map();
  for (const instance of instances) {
    const key = instance.spaceId ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(instance);
  }
  // Include every space so quantities can also be assigned to a new space.
  const destinations = [...spaces];
  for (const key of groups.keys()) {
    if (!destinations.some((s) => s.id === key)) destinations.push({ id: key, name: 'Неизвестное пространство' });
  }
  for (const space of destinations) {
    const items = [...(groups.get(space.id) || [])];
    const count = el('input', { type: 'number', min: '0', step: '1', value: String(items.length), style: 'width:90px' });
    const assigned = el('input', { type: 'checkbox' });
    assigned.checked = Boolean(space.id && ((tool.spaceIds || []).includes(space.id) || items.length));
    assigned.disabled = !space.id || items.length > 0;
    count.oninput = () => { if (space.id && Number(count.value) > 0) assigned.checked = true; };
    rows.push({ spaceId: space.id, items, count, assigned });
    rowsWrap.append(el('div', { class: 'field' }, [el('label', {}, [assigned, ' ', space.name]), count]));
  }
  openModal({
    title: 'Изменить инструмент',
    body: el('div', {}, [
      name.field,
      el('div', { class: 'muted' }, 'Количество экземпляров по пространствам (итоговое):'),
      rowsWrap,
    ]),
    onSubmit: async () => {
      if (saving) throw new Error('Сохранение уже выполняется');
      const nextName = name.input.value.trim();
      if (!nextName) throw new Error('Укажите название');
      const targets = rows.map((row) => ({ row, target: Number(row.count.value) }));
      if (targets.some(({ row, target }) => !row.count.value.trim() || !Number.isSafeInteger(target) || target < 0)) {
        throw new Error('Количество должно быть целым числом от 0');
      }
      saving = true;
      name.input.disabled = true;
      rows.forEach((row) => { row.count.disabled = true; });
      try {
        const spaceIds = targets.filter(({ row, target }) => row.spaceId && (row.assigned.checked || target > 0 || row.items.length)).map(({ row }) => row.spaceId);
        if (!spaceIds.length) throw new Error('Выберите хотя бы одно пространство инструмента');
        await api.update('tools', tool.id, { name: nextName, spaceIds });
        for (const { row, target } of targets) {
          // Keep successful changes in the local list so a retry does not duplicate them.
          row.items.sort((a, b) => (a.label ? 1 : 0) - (b.label ? 1 : 0));
          while (row.items.length > target) {
            await api.remove('tool-instances', row.items[0].id);
            row.items.shift();
          }
          while (row.items.length < target) {
            const instance = await api.create('tool-instances', { toolId: tool.id, spaceId: row.spaceId });
            row.items.push(instance);
          }
        }
        await render(mount, api);
      } catch (error) {
        await render(mount, api);
        throw error;
      } finally {
        saving = false;
        name.input.disabled = false;
        rows.forEach((row) => { row.count.disabled = false; });
      }
    },
  });
}

function openCreate(mount, api) {
  let spacesCache = [];
  const rowsWrap = el('div', {});
  const name = textField('Название инструмента');

  const addRow = () => {
    const sel = el('select', {});
    sel.append(el('option', { value: '' }, 'Выберите пространство'));
    for (const s of spacesCache) sel.append(el('option', { value: s.id }, s.name));
    const count = el('input', { type: 'number', min: '0', value: '1', style: 'width:80px' });
    rowsWrap.append(el('div', { class: 'field', style: 'display:flex;gap:8px;align-items:flex-end' }, [
      el('div', { style: 'flex:1' }, [el('label', {}, 'Пространство'), sel]),
      el('div', {}, [el('label', {}, 'Кол-во'), count]),
    ]));
    rowsWrap.lastChild._get = () => ({ spaceId: sel.value || null, count: Number(count.value) || 0 });
  };

  api.list('spaces').then((s) => { spacesCache = s; addRow(); });

  openModal({
    title: 'Новый инструмент',
    body: el('div', {}, [
      name.field,
      el('div', { class: 'muted' }, 'Распределение экземпляров по пространствам:'),
      rowsWrap,
      el('button', { class: 'btn secondary', onclick: addRow }, '+ строка'),
    ]),
    onSubmit: async () => {
      const distribution = [...rowsWrap.children].map((r) => r._get());
      if (!distribution.length || distribution.some((d) => !d.spaceId)) throw new Error('Выберите пространство в каждой строке');
      await api.create('tools', { name: name.input.value, distribution });
      await render(mount, api);
    },
  });
}

// Добавление экземпляра: сразу можно задать название и пространство.
function addInstance(tool, spaces, mount, api) {
  const label = textField('Название экземпляра (необязательно)');
  const sel = el('select', {});
  sel.append(el('option', { value: '' }, 'Выберите пространство'));
  for (const s of spaces) sel.append(el('option', { value: s.id }, s.name));
  openModal({
    title: `Экземпляр: ${tool.name}`,
    body: el('div', {}, [
      label.field,
      el('div', { class: 'field' }, [el('label', {}, 'Пространство'), sel]),
    ]),
    onSubmit: async () => {
      await api.create('tool-instances', {
        toolId: tool.id,
        spaceId: sel.value || null,
        label: label.input.value.trim() || null,
      });
      await render(mount, api);
    },
  });
}

async function del(tool, mount, api) {
  if (!confirm('Удалить инструмент?')) return;
  try { await api.remove('tools', tool.id); await render(mount, api); }
  catch (e) { alert(e.message); }
}
