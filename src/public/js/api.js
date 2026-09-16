import { getToken } from './bitrixAuth.js';
async function request(path, options = {}) {
  const res = await fetch(`api/${path}`, {
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { 'X-B24-Token': getToken() } : {}) },
    signal: AbortSignal.timeout(25000),
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let payload = {};
  try { payload = await res.json(); } catch { /* empty response */ }
  if (!res.ok || payload.ok === false) {
    const msg = payload?.error?.message || `Ошибка ${res.status}`;
    throw Object.assign(new Error(msg), {status:res.status});
  }
  return payload.data;
}

export const api = {
  list: (entity) => request(entity),
  create: (entity, body) => request(entity, { method: 'POST', body }),
  update: (entity, id, body) => request(`${entity}/${id}`, { method: 'PUT', body }),
  remove: (entity, id) => request(`${entity}/${id}`, { method: 'DELETE' }),
  post: (path, body) => request(path, { method: 'POST', body }),
  get: (path) => request(path),
};
