import { employeesRepo } from '../repositories/employeesRepo.js';
import { Router } from 'express';
import { asyncH, ok } from './crudRouter.js';
import { payrollService } from '../services/payrollService.js';

const r = Router();

r.get('/', asyncH(async (req, res) => ok(res, await payrollService.calc({ ...req.query, ...(req.access?.isAdmin ? {} : { employeeId: (await employeesRepo.list()).find((e) => String(e.b24UserId) === req.access?.userId)?.id || '__no_employee__' }) }))));

export default r;
