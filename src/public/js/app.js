import { initializeBitrix } from './bitrixAuth.js';
import { access, setAccess } from './access.js';
import { rolesView } from './views/roles.js';
import { payrollView } from './views/payroll.js';
import { el } from './ui.js';
import { api } from './api.js';
import { spacesView } from './views/spaces.js';
import { workPointsView } from './views/workPoints.js';
import { toolsView } from './views/tools.js';
import { servicesView } from './views/services.js';
import { employeesView } from './views/employees.js';
import { calendarView } from './views/calendar.js';

const TABS = [
  { id: 'bookings', label: 'Записи', view: calendarView },
  { id: 'spaces', label: 'Пространства', view: spacesView },
  { id: 'work-points', label: 'Рабочие точки', view: workPointsView },
  { id: 'tools', label: 'Инструменты', view: toolsView },
  { id: 'services', label: 'Услуги', view: servicesView },
  { id: 'roles', label: 'Права доступа', view: rolesView },
  { id: 'payroll', label: 'Зарплата', view: payrollView },
  { id: 'employees', label: 'Сотрудники', view: employeesView },
];

const tabsNav = document.getElementById('tabs');
const viewMount = document.getElementById('view');
const titleEl = document.getElementById('view-title');

let dispose;
function activate(tab) {
  if (dispose) dispose();
  [...tabsNav.children].forEach((b) => b.classList.toggle('active', b.dataset.id === tab.id));
  titleEl.textContent = tab.label;
  viewMount.innerHTML = '';
  dispose = tab.view(viewMount, api);
}

async function start() {
try {
  await initializeBitrix();
  setAccess(await api.get('auth/me'));
for (const tab of TABS.filter((t) => access.isAdmin || !['services','roles'].includes(t.id))) {
  tabsNav.append(el('button', { 'data-id': tab.id, onclick: () => activate(tab) }, tab.label));
}
activate(TABS[0]);
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#bookings')) activate(TABS[0]);
});

} catch(e) { titleEl.textContent = 'Не удалось открыть приложение'; viewMount.textContent = e.message; }
}
start();
