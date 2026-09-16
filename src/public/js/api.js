async function request(path, options = {}) {
  const res = await fetch(`api/${path}`, {
    headers: { 'Content-Type': 'application/json', ...(window.BX24?.getAuth()?.access_token ? { 'X-B24-Token': window.BX24.getAuth().access_token } : {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let payload = {};
  try { payload = await res.json(); } catch { /* empty response */ }
  if (!res.ok || payload.ok === false) {
    const msg = payload?.error?.message || `Ошибка ${res.status}`;
    throw new Error(msg);
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
