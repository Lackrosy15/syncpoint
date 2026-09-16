import { canEdit } from './access.js';
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function openModal({ title, body, submitLabel = 'Сохранить', onSubmit }) {
  const root = document.getElementById('modal-root');
  const errBox = el('div', { class: 'error' });
  let saving = false;
  const close = () => { if (!saving) root.innerHTML = ''; };

  const submit = el('button', { class: 'btn', onclick: async () => {
    if (saving) return;
    saving = true;
    submit.disabled = true;
    errBox.textContent = '';
    try { await onSubmit(); saving = false; close(); }
    catch (e) { errBox.textContent = e.message; }
    finally { saving = false; submit.disabled = false; }
  } }, submitLabel);

  const modal = el('div', { class: 'modal-bg', onclick: (e) => { if (e.target.classList.contains('modal-bg')) close(); } }, [
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('h2', {}, title),
      body,
      errBox,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn secondary', onclick: close }, 'Отмена'),
        submit,
      ]),
    ]),
  ]);
  root.innerHTML = '';
  root.append(modal);
}

export function textField(label, value = '') {
  const input = el('input', { type: 'text', value });
  return { field: el('div', { class: 'field' }, [el('label', {}, label), input]), input };
}

export function selectField(label, options, value = '') {
  const select = el('select', {});
  for (const o of options) {
    const opt = el('option', { value: o.value }, o.label);
    if (String(o.value) === String(value)) opt.selected = true;
    select.append(opt);
  }
  return { field: el('div', { class: 'field' }, [el('label', {}, label), select]), select };
}

export async function crudView(mount, config, api) {
  async function refresh() {
    mount.innerHTML = '';
    const toolbar = el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn', onclick: () => openForm() }, config.addLabel || 'Добавить'),
      ...(config.extraButtons ? config.extraButtons(refresh) : []),
    ]);
    if (canEdit(config.entity)) mount.append(toolbar);

    let items = [];
    try { items = await api.list(config.entity); }
    catch (e) { mount.append(el('div', { class: 'banner' }, e.message)); }

    if (!items.length) mount.append(el('div', { class: 'muted' }, 'Пока пусто.'));
    for (const item of items) {
      mount.append(el('div', { class: 'row' }, [
        config.render(item),
        canEdit(config.entity) ? el('div', {}, [
          el('button', { class: 'btn link', onclick: () => openForm(item) }, 'Изменить'),
          el('button', { class: 'btn link', onclick: () => del(item) }, 'Удалить'),
        ]) : null,
      ]));
    }
  }

  function openForm(item) {
    const { body, collect } = config.buildForm(item);
    openModal({
      title: item ? 'Изменить' : (config.addLabel || 'Добавить'),
      body,
      onSubmit: async () => {
        const data = collect();
        if (item) await api.update(config.entity, item.id, data);
        else if (config.onCreate) await config.onCreate(data);
        else await api.create(config.entity, data);
        await refresh();
      },
    });
  }

  async function del(item) {
    if (!confirm('Удалить запись?')) return;
    try { await api.remove(config.entity, item.id); await refresh(); }
    catch (e) { alert(e.message); }
  }

  await refresh();
}
