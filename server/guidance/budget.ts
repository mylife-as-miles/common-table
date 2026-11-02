import type { SharedDatabase } from '../shared-tables/index.ts';
import { GuidanceError } from './errors.ts';
export const BUDGET_SCOPE='global-test-v1';
export const CAP_CENTS=500;
export const RESERVATION_CENTS=5;
export const MAX_ATTEMPTS=100;
export interface BudgetState {initialized:boolean;attempts:number;reservedCents:number}
type Row=Record<string,unknown>;
/** A missing or inconsistent initialized ledger always fails closed. No runtime refill exists. */
export async function readBudget(db:SharedDatabase):Promise<BudgetState>{
  try {
    const row=await db.prepare(`SELECT b.cap_cents,b.reserved_cents,b.attempts,i.operation_id,
      (SELECT COUNT(*) FROM ai_test_attempts WHERE scope=?) AS history_count,
      (SELECT COALESCE(SUM(reservation_cents),0) FROM ai_test_attempts WHERE scope=?) AS history_cents,
      (SELECT COALESCE(MAX(attempt),0) FROM ai_test_attempts WHERE scope=?) AS history_max,
      (SELECT COUNT(*) FROM ai_test_attempts WHERE scope=? AND reservation_cents<>5) AS history_invalid
      FROM ai_budget_initialization i LEFT JOIN ai_test_budget b ON b.scope=i.scope WHERE i.scope=?`).bind(BUDGET_SCOPE,BUDGET_SCOPE,BUDGET_SCOPE,BUDGET_SCOPE,BUDGET_SCOPE).first<Row>();
    if(!row){
      const orphan=await db.prepare(`SELECT (SELECT COUNT(*) FROM ai_test_budget WHERE scope=?) + (SELECT COUNT(*) FROM ai_test_attempts WHERE scope=?) AS n`).bind(BUDGET_SCOPE,BUDGET_SCOPE).first<Row>();
      if(!orphan || orphan.n!==0)throw new GuidanceError('budget_unavailable',503);
      return {initialized:false,attempts:0,reservedCents:0};
    }
    if(typeof row.operation_id!=='string'||!row.operation_id||row.cap_cents!==CAP_CENTS||!Number.isSafeInteger(row.attempts)||Number(row.attempts)<0||Number(row.attempts)>MAX_ATTEMPTS||row.reserved_cents!==Number(row.attempts)*RESERVATION_CENTS||row.history_count!==row.attempts||row.history_cents!==row.reserved_cents||row.history_max!==row.attempts||row.history_invalid!==0)throw new GuidanceError('budget_unavailable',503);
    return {initialized:true,attempts:Number(row.attempts),reservedCents:Number(row.reserved_cents)};
  }catch(error){if(error instanceof GuidanceError)throw error;throw new GuidanceError('budget_unavailable',503);}
}
/** Explicit owner action only; the durable marker makes repeated enable unable to refill a deleted ledger. */
export async function initializeBudget(db:SharedDatabase):Promise<BudgetState>{
  const before=await readBudget(db);if(before.initialized)return before;
  const operation=crypto.randomUUID(),now=Date.now();
  try{
    await db.batch([
      db.prepare(`INSERT INTO ai_budget_initialization(scope,operation_id,initialized_at)
        SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM ai_budget_initialization WHERE scope=?)
        AND NOT EXISTS(SELECT 1 FROM ai_test_budget WHERE scope=?)
        AND NOT EXISTS(SELECT 1 FROM ai_test_attempts WHERE scope=?)`).bind(BUDGET_SCOPE,operation,now,BUDGET_SCOPE,BUDGET_SCOPE,BUDGET_SCOPE),
      db.prepare(`INSERT INTO ai_test_budget(scope,cap_cents,reserved_cents,attempts,updated_at)
        SELECT ?,500,0,0,? WHERE EXISTS(SELECT 1 FROM ai_budget_initialization WHERE scope=? AND operation_id=?)
        AND NOT EXISTS(SELECT 1 FROM ai_test_budget WHERE scope=?)
        AND NOT EXISTS(SELECT 1 FROM ai_test_attempts WHERE scope=?)`).bind(BUDGET_SCOPE,now,BUDGET_SCOPE,operation,BUDGET_SCOPE,BUDGET_SCOPE),
    ]);
    const after=await readBudget(db);if(!after.initialized)throw new GuidanceError('budget_unavailable',503);return after;
  }catch(error){if(error instanceof GuidanceError)throw error;throw new GuidanceError('budget_unavailable',503);}
}
/** One atomic receipt before any paid request. Failed, rejected and aborted attempts are never released. */
export async function reserveGuidance(db:SharedDatabase):Promise<{id:string;attempt:number;reservationCents:5}>{
  const before=await readBudget(db);if(!before.initialized)throw new GuidanceError('budget_unavailable',503);if(before.attempts>=MAX_ATTEMPTS)throw new GuidanceError('budget_exhausted',429);
  const id=crypto.randomUUID(),now=Date.now();
  try{
    await db.batch([
      db.prepare(`UPDATE ai_test_budget SET attempts=attempts+1,reserved_cents=reserved_cents+5,updated_at=?
        WHERE scope=? AND cap_cents=500 AND attempts<100 AND reserved_cents=attempts*5
        AND attempts=(SELECT COUNT(*) FROM ai_test_attempts WHERE scope=?)
        AND reserved_cents=(SELECT COALESCE(SUM(reservation_cents),0) FROM ai_test_attempts WHERE scope=?)
        AND EXISTS(SELECT 1 FROM ai_budget_initialization WHERE scope=?)`).bind(now,BUDGET_SCOPE,BUDGET_SCOPE,BUDGET_SCOPE,BUDGET_SCOPE),
      db.prepare(`INSERT INTO ai_test_attempts(id,scope,attempt,reservation_cents,created_at)
        SELECT ?,scope,attempts,5,? FROM ai_test_budget WHERE scope=? AND cap_cents=500
        AND reserved_cents=attempts*5 AND attempts=(SELECT COUNT(*)+1 FROM ai_test_attempts WHERE scope=?)
        AND EXISTS(SELECT 1 FROM ai_budget_initialization WHERE scope=?)`).bind(id,now,BUDGET_SCOPE,BUDGET_SCOPE,BUDGET_SCOPE),
    ]);
    const receipt=await db.prepare('SELECT attempt,reservation_cents FROM ai_test_attempts WHERE id=? AND scope=?').bind(id,BUDGET_SCOPE).first<Row>();
    if(!receipt){const state=await readBudget(db);throw new GuidanceError(state.attempts>=MAX_ATTEMPTS?'budget_exhausted':'budget_unavailable',state.attempts>=MAX_ATTEMPTS?429:503);}
    if(!Number.isSafeInteger(receipt.attempt)||Number(receipt.attempt)<1||Number(receipt.attempt)>MAX_ATTEMPTS||receipt.reservation_cents!==RESERVATION_CENTS)throw new GuidanceError('budget_unavailable',503);
    await readBudget(db);
    return {id,attempt:Number(receipt.attempt),reservationCents:5};
  }catch(error){if(error instanceof GuidanceError)throw error;throw new GuidanceError('budget_unavailable',503);}
}
