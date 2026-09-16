import { el, textField, openModal } from '../ui.js';
import { defaultPrice } from '../servicePrice.js';

export function servicesView(mount, api) {
  render(mount, api);
}

async function render(mount, api) {
  mount.innerHTML = '';
  mount.append(el('div', { class: 'toolbar' }, [
    el('button', { class: 'btn', onclick: () => openForm(mount, api) }, 'Добавить услугу'),
    el('button', { class: 'btn secondary', onclick: () => openCategories(mount, api) }, 'Категории услуг'),
  ]));

  let services = [], categories = [];
  try { [services, categories] = await Promise.all([api.list('services'), api.list('service-categories')]); }
  catch (e) { mount.append(el('div', { class: 'banner' }, e.message)); }

  if (!services.length) mount.append(el('div', { class: 'muted' }, 'Пока пусто.'));
  for (const category of [...categories, { id: null, name: 'Без категории' }]) {
    const items = services.filter((s) => (categories.some((c) => c.id === s.categoryId) ? s.categoryId : null) === category.id);
    if (!items.length) continue;
    const section = el('section', { class: 'service-category' }, el('h2', {}, category.name));
    mount.append(section);
    for (const s of items) {
    section.append(el('div', { class: 'row' }, [
      el('div', {}, [el('b', {}, s.name), el('div', { class: 'meta' }, priceText(s, services)),
        s.isComposite ? el('div', { class: 'service-composition' }, [el('strong', {}, 'В составе: '), (s.childServiceIds || []).map((id) => services.find((v) => v.id === id)?.name || 'Недоступная услуга').join(', ')]) : null]),
      el('div', {}, [
        el('button', { class: 'btn link', onclick: () => openForm(mount, api, s) }, 'Изменить'),
        el('button', { class: 'btn link', onclick: () => del(s, mount, api) }, 'Удалить'),
      ]),
    ]));
    }
  }
}

function priceText(s, services) {
  if (s.isComposite) {
    const label = { auto: 'Сумма под-услуг', fixed: 'Своя цена', manual: 'Указать при записи' }[s.compositeSum];
    return `Составная · ${label} · ${defaultPrice(s, new Map(services.map((s) => [s.id, s])))} ₽`;
  }
  if (s.priceType === 'manual') return `Указать при записи · по умолчанию ${s.price ?? 0} ₽`;
  if (s.priceType === 'fixed') return `${s.price} ₽`;
  return `${s.priceMin}–${s.priceMax} ₽`;
}

async function openForm(mount, api, item) {
  let services, tools, categories;
  try { [services, tools, categories] = await Promise.all([api.list('services'), api.list('tools'), api.list('service-categories')]); }
  catch (e) { alert(e.message); return; }
  const others = services.filter((s) => s.id !== item?.id);

  const name = textField('Название', item?.name || '');
  const category = el('select', {}, [el('option', { value: '' }, 'Без категории'),
    ...categories.map((c) => el('option', { value: c.id }, c.name))]);
  category.value = item?.categoryId || '';

  const kind = el('select', {});
  kind.append(el('option', { value: 'simple' }, 'Простая'));
  kind.append(el('option', { value: 'composite' }, 'Составная'));
  kind.value = item?.isComposite ? 'composite' : 'simple';

  const priceType = el('select', {});
  priceType.append(el('option', { value: 'fixed' }, 'Фиксированная'));
  priceType.append(el('option', { value: 'range' }, 'Диапазон'));
  priceType.append(el('option', { value: 'manual' }, 'Указать при записи'));
  priceType.value = item?.priceType || 'fixed';
  const price = el('input', { type: 'number', min: '0', value: item?.price ?? '' });
  const priceMin = el('input', { type: 'number', min: '0', value: item?.priceMin ?? '' });
  const priceMax = el('input', { type: 'number', min: '0', value: item?.priceMax ?? '' });

  const compositeSum = el('select', {});
  const compositePrice = el('input', { type: 'number', min: '0', step: 'any', value: item?.price ?? '' });
  for (const [v, l] of [['auto', 'Сумма под-услуг'], ['fixed', 'Своя цена'], ['manual', 'Указать при записи']]) {
    compositeSum.append(el('option', { value: v }, l));
  }
  compositeSum.value = item?.compositeSum || 'auto';
  const childChecks = others.map((o) => {
    const cb = el('input', { type: 'checkbox', value: o.id });
    if (item?.childServiceIds?.includes(o.id)) cb.checked = true;
    return { id: o.id, cb, node: el('label', { style: 'display:flex;align-items:center;gap:8px;padding:2px 4px;justify-content:flex-start' }, [cb, el('span', {}, o.name)]) };
  });

  const toolChecks = tools.map((t) => {
    const cb = el('input', { type: 'checkbox', value: t.id });
    if (item?.requiredToolIds?.includes(t.id)) cb.checked = true;
    const count = el('input', { type: 'number', min: '1', step: '1', value: item?.requiredToolCounts?.[t.id] ?? 1,
      'aria-label': `Количество: ${t.name}` });
    count.disabled = !cb.checked;
    cb.addEventListener('change', () => { count.disabled = !cb.checked; });
    return { id: t.id, cb, count, node: el('div', { class: 'tool-requirement' }, [
      el('label', {}, [cb, el('span', {}, t.name)]), count,
    ]) };
  });

  const simpleBox = el('div', {}, [
    el('div', { class: 'field' }, [el('label', {}, 'Тип цены'), priceType]),
    el('div', { class: 'field' }, [el('label', {}, 'Цена (фикс)'), price]),
    el('div', { class: 'field' }, [el('label', {}, 'Мин'), priceMin]),
    el('div', { class: 'field' }, [el('label', {}, 'Макс'), priceMax]),
  ]);
  const compositeBox = el('div', {}, [
    el('div', { class: 'field' }, [el('label', {}, 'Способ суммы'), compositeSum]),
    el('div', { class: 'field' }, [el('label', {}, 'Своя цена, ₽'), compositePrice]),
    el('div', { class: 'field' }, [el('label', {}, 'Под-услуги'),
      el('div', { class: 'checklist' }, childChecks.map((c) => c.node))]),
  ]);

  const syncVisibility = () => {
    compositePrice.parentElement.querySelector('label').textContent = compositeSum.value === 'manual' ? 'Цена по умолчанию, ₽ (пусто — сумма под-услуг)' : 'Своя цена, ₽';
    price.parentElement.querySelector('label').textContent = priceType.value === 'manual' ? 'Цена по умолчанию, ₽' : 'Цена, ₽';
    const composite = kind.value === 'composite';
    compositeBox.style.display = composite ? 'block' : 'none';
    compositePrice.parentElement.style.display = ['fixed', 'manual'].includes(compositeSum.value) ? 'block' : 'none';
    simpleBox.style.display = composite ? 'none' : 'block';
    price.parentElement.style.display = ['fixed', 'manual'].includes(priceType.value) ? 'block' : 'none';
    priceMin.parentElement.style.display = priceType.value === 'range' ? 'block' : 'none';
    priceMax.parentElement.style.display = priceType.value === 'range' ? 'block' : 'none';
  };
  kind.addEventListener('change', syncVisibility);
  compositeSum.addEventListener('change', syncVisibility);
  priceType.addEventListener('change', syncVisibility);

  const body = el('div', {}, [
    name.field,
    el('div', { class: 'field' }, [el('label', {}, 'Категория'), category]),
    el('div', { class: 'field' }, [el('label', {}, 'Вид услуги'), kind]),
    simpleBox,
    compositeBox,
    el('div', { class: 'field' }, [el('label', {}, 'Нужные инструменты'),
      el('div', { class: 'muted' }, 'Отметьте инструменты и укажите количество экземпляров.'),
      el('div', { class: 'checklist' }, toolChecks.length ? toolChecks.map((c) => c.node) : [el('span', { class: 'muted' }, 'нет инструментов')])]),
  ]);
  setTimeout(syncVisibility, 0);

  openModal({
    title: item ? 'Изменить услугу' : 'Новая услуга',
    body,
    onSubmit: async () => {
      const requiredToolIds = toolChecks.filter((c) => c.cb.checked).map((c) => c.id);
      const requiredToolCounts = {};
      for (const c of toolChecks.filter((c) => c.cb.checked)) {
        const count = Number(c.count.value);
        if (!Number.isSafeInteger(count) || count < 1) throw new Error('Количество инструмента должно быть целым числом от 1');
        requiredToolCounts[c.id] = count;
      }
      let data;
      if (kind.value === 'composite') {
        if (compositeSum.value === 'fixed' && (compositePrice.value.trim() === '' || !Number.isFinite(Number(compositePrice.value)) || Number(compositePrice.value) < 0)) {
          throw new Error('Укажите свою цену от 0');
        }
        data = {
          name: name.input.value, isComposite: true,
          compositeSum: compositeSum.value,
          childServiceIds: childChecks.filter((c) => c.cb.checked).map((c) => c.id),
          price: ['fixed', 'manual'].includes(compositeSum.value) && compositePrice.value !== '' ? Number(compositePrice.value) : null,
          requiredToolIds, requiredToolCounts,
        };
      } else {
        data = {
          name: name.input.value, isComposite: false, priceType: priceType.value,
          price: ['fixed', 'manual'].includes(priceType.value) ? Number(price.value) : null,
          priceMin: priceType.value === 'range' ? Number(priceMin.value) : null,
          priceMax: priceType.value === 'range' ? Number(priceMax.value) : null,
          requiredToolIds, requiredToolCounts,
        };
      }
      data.categoryId = category.value || null;
      if (item) await api.update('services', item.id, data);
      else await api.create('services', data);
      await render(mount, api);
    },
  });
}

async function del(s, mount, api) {
  if (!confirm('Удалить услугу?')) return;
  try { await api.remove('services', s.id); await render(mount, api); }
  catch (e) { alert(e.message); }
}

async function openCategories(mount, api) {
  let categories;
  try { categories = await api.list('service-categories'); }
  catch (e) { alert(e.message); return; }
  const list = el('div', { class: 'category-list' });
  if (!categories.length) list.append(el('div', { class: 'muted category-empty' }, 'Категорий пока нет. Добавьте первую ниже.'));
  const name = textField('Название новой категории');
  const error = el('div', { class: 'error' });
  const add = el('button', { class: 'btn secondary', onclick: async () => {
    add.disabled = true;
    try {
      await api.create('service-categories', { name: name.input.value });
      await render(mount, api);
      await openCategories(mount, api);
    } catch (e) { error.textContent = e.message; }
    finally { add.disabled = false; }
  } }, 'Добавить категорию');
  for (const c of categories) {
    const field = textField('Название категории', c.name);
    const title = el('span', { class: 'category-name' }, c.name);
    const editor = el('div', { class: 'category-editor', hidden: '' });
    const confirmation = el('div', { class: 'category-confirm', hidden: '' });
    const row = el('div', { class: 'category-card' });
    const save = el('button', { class: 'btn link', onclick: async () => {
      save.disabled = true;
      try {
        const updated = await api.update('service-categories', c.id, { name: field.input.value });
        c.name = updated.name;
        title.textContent = c.name;
        editor.hidden = true;
        error.textContent = '';
        await render(mount, api);
      }
      catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    } }, 'Сохранить');
    const edit = el('button', { class: 'btn link', onclick: () => {
      confirmation.hidden = true;
      editor.hidden = false;
      field.input.value = c.name;
      field.input.focus();
    } }, 'Изменить');
    const question = el('div', {});
    const yes = el('button', { class: 'btn danger', onclick: async () => {
      yes.disabled = true;
      try {
        await api.remove('service-categories', c.id);
        row.remove();
        error.textContent = '';
        if (!list.children.length) list.append(el('div', { class: 'muted category-empty' }, 'Категорий пока нет. Добавьте первую ниже.'));
        await render(mount, api);
      }
      catch (e) { error.textContent = e.message; }
      finally { yes.disabled = false; }
    } }, 'Да, удалить');
    const remove = el('button', { class: 'category-delete', title: 'Удалить категорию', 'aria-label': `Удалить категорию ${c.name}`, onclick: () => {
      editor.hidden = true;
      question.textContent = `Удалить категорию «${c.name}»?`;
      confirmation.hidden = false;
    } });
    remove.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
    editor.append(field.field, el('div', { class: 'category-actions' }, [save,
      el('button', { class: 'btn link', onclick: () => { editor.hidden = true; } }, 'Отмена')]));
    confirmation.append(question, el('div', { class: 'category-actions' }, [yes,
      el('button', { class: 'btn secondary', onclick: () => { confirmation.hidden = true; } }, 'Нет, оставить')]));
    row.append(el('div', { class: 'category-line' }, [title, edit, remove]), editor, confirmation);
    list.append(row);
  }
  openModal({ title: 'Категории услуг', body: el('div', {}, [list,
    el('div', { class: 'category-create' }, [name.field, add]), error]),
    submitLabel: 'Готово', onSubmit: async () => {} });
}
