import { readFile } from 'node:fs/promises';
import { verifyBitrix, resolveAccess, allowed, accessStore, updateAccess } from './services/accessService.js';
import { employeesRepo } from './repositories/employeesRepo.js';
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import spacesRouter from './routes/spaces.js';
import workPointsRouter from './routes/workPoints.js';
import toolsRouter from './routes/tools.js';
import toolInstancesRouter from './routes/toolInstances.js';
import servicesRouter from './routes/services.js';
import serviceCategoriesRouter from './routes/serviceCategories.js';
import employeesRouter from './routes/employees.js';
import b24Router from './routes/b24.js';
import bookingsRouter from './routes/bookings.js';
import payrollRouter from './routes/payroll.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, data: { status: 'up' } }));

app.use('/api', async (req,res,next)=>{
  try {
    res.set('Cache-Control','no-store');
    req.access = await resolveAccess(await (app.locals.verifyIdentity || verifyBitrix)(req));
    if (!allowed(req.access, req.method, req.path)) return res.status(403).json({ok:false,error:{message:'Недостаточно прав'}});
    if (!req.access.isAdmin) {
      const employeeResponse = /^\/employees(?:\/|$)/.test(req.path);
      const json = res.json.bind(res);
      res.json = (payload) => {
        if (payload.ok && employeeResponse) {
          const clean = (e) => { const { salary, ...rest } = e; return rest; };
          payload = {...payload,data:Array.isArray(payload.data)?payload.data.map(clean):clean(payload.data)};
        }
        return json(payload);
      };
    }
    next();
  } catch(e) { next(e); }
});
app.get('/api/auth/me',(req,res)=>res.json({ok:true,data:req.access}));
app.get('/api/access',async(req,res,next)=>{try {res.json({ok:true,data:await accessStore.get('roles')});}catch(e){next(e);}});
app.put('/api/access/:userId',async(req,res,next)=>{try {res.json({ok:true,data:await updateAccess(req.params.userId,req.body)});}catch(e){next(e);}});

app.use('/api/spaces', spacesRouter);
app.use('/api/work-points', workPointsRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/tool-instances', toolInstancesRouter);
app.use('/api/services', servicesRouter);
app.use('/api/service-categories', serviceCategoriesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/b24', b24Router);
app.use('/api/bookings', bookingsRouter);
app.use('/api/payroll', payrollRouter);

app.post('/', async (req, res, next) => {
  try {
    const token = req.body?.AUTH_ID || req.body?.auth?.access_token;
    const launch = JSON.stringify({ access_token: typeof token === 'string' ? token : '' }).replaceAll('<', '\\u003c');
    const html = await readFile(join(__dirname, 'public', 'index.html'), 'utf8');
    res.set('Cache-Control', 'no-store');
    res.send(html.replace('<!-- LAUNCH_AUTH -->', () => '<script type="application/json" id="launch-auth">' + launch + '</script>'));
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    ok: false,
    error: { message: err.message || 'Внутренняя ошибка', code: err.code || 'INTERNAL' },
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
  });
}

export default app;
