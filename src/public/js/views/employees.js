import { access } from '../access.js';
import { openSalaryForm } from './salaryForm.js';
import { el, textField, openModal } from '../ui.js';

export function employeesView(mount, api) {
  render(mount, api);
}

async function render(mount, api) {
  mount.innerHTML = '';
  if (access.isAdmin) mount.append(el('div', { class: 'toolbar' }, [
    el('button', { class: 'btn', onclick: () => importFromB24(mount, api) }, 'Загрузить из Битрикс24'),
    el('button', { class: 'btn secondary', onclick: () => addManual(mount, api) }, 'Добавить вручную'),
  ]));

  let employees = [];
  try { employees = await api.list('employees'); }
  catch (e) { mount.append(el('div', { class: 'banner' }, e.message)); }

  if (!employees.length) mount.append(el('div', { class: 'muted' }, 'Пока пусто.'));
  for (const e of employees) {
    mount.append(el('div', { class: 'row' }, [
      el('div', {}, [el('b', {}, e.name), ' ', el('span', { class: 'badge' }, e.source === 'b24' ? 'Б24' : 'вручную')]),
      access.isAdmin ? el('div', {}, [el('button', { class: 'btn secondary', onclick: () => openSalaryForm(e, api, () => render(mount, api)) }, 'Настройки зарплаты'), el('button', { class: 'btn link', onclick: () => del(e, mount, api) }, 'Удалить')]) : null,
    ]));
  }
}

function addManual(mount, api) {
  const name = textField('Имя сотрудника');
  openModal({
    title: 'Добавить вручную',
    body: el('div', {}, [name.field]),
    onSubmit: async () => { await api.create('employees', { name: name.input.value }); await render(mount, api); },
  });
}

async function importFromB24(mount, api) {
  let users = [];
  try { users = await api.get('b24/users'); }
  catch (e) {
    openModal({ title: 'Импорт из Битрикс24', body: el('div', { class: 'banner' }, `Не удалось загрузить пользователей Б24: ${e.message}`), submitLabel: 'Ок', onSubmit: async () => {} });
    return;
  }
  const checks = users.map((u) => {
    const cb = el('input', { type: 'checkbox', value: u.id });
    return { user: u, cb, node: el('label', {}, [cb, ` ${u.name}`]) };
  });
  openModal({
    title: 'Выберите сотрудников',
    body: el('div', { class: 'checklist' }, checks.length ? checks.map((c) => c.node) : [el('span', { class: 'muted' }, 'Пользователи не найдены')]),
    submitLabel: 'Импортировать',
    onSubmit: async () => {
      const selected = checks.filter((c) => c.cb.checked).map((c) => c.user);
      await api.post('employees/import', { users: selected });
      await render(mount, api);
    },
  });
}

async function del(e, mount, api) {
  if (!confirm('Удалить сотрудника?')) return;
  try { await api.remove('employees', e.id); await render(mount, api); }
  catch (err) { alert(err.message); }
}
