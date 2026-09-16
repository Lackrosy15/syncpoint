import { accessStore } from '../src/services/accessService.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app from '../src/server.js';
import { spacesRepo } from '../src/repositories/spacesRepo.js';

let server, base;
before(async () => {
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'sp-srv-http-'));
  spacesRepo._store._reset(); accessStore._reset();
  app.locals.verifyIdentity = async () => ({userId:'1',name:'Admin',canInstall:true});
});

test('GET /api/health → ok', async () => {
  const r = await fetch(`${base}/api/health`);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.ok, true);
});

test('CRUD пространства через HTTP', async () => {
  const create = await fetch(`${base}/api/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Пост 1' }),
  });
  assert.equal(create.status, 201);
  const { data } = await create.json();
  assert.equal(data.name, 'Пост 1');

  const list = await (await fetch(`${base}/api/spaces`)).json();
  assert.equal(list.data.length, 1);
});

test('ошибка валидации → 400 и {ok:false}', async () => {
  const r = await fetch(`${base}/api/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '' }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'VALIDATION');
});

test('POST launch embeds token safely without caching or blocking external script', async () => {
  const token = '</script><script>alert(1)</script>';
  const r=await fetch(base.replace('/api','')+'/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({AUTH_ID:token})});
  const html=await r.text();
  assert.equal(r.headers.get('cache-control'),'no-store');
  assert.ok(!html.includes(token));
  const encoded=html.match(/id="launch-auth">(.*?)<\/script>/)[1];
  assert.equal(JSON.parse(encoded).access_token,token);
  assert.ok(!html.includes('<script src="https://api.bitrix24.com'));
});
