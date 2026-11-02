import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSharedD1 } from './helpers/shared-d1.ts';
import { initializeBudget, readBudget, reserveGuidance, BUDGET_SCOPE } from '../server/guidance/budget.ts';
import { GuidanceError } from '../server/guidance/errors.ts';
const rejects=(code:string)=>(error:unknown)=>error instanceof GuidanceError&&error.code===code;

test('allowance is initialized only by explicit setup and charges five irrevocable cents per attempt up to the original five dollars',async t=>{
  const fixture=createSharedD1();t.after(fixture.close);
  assert.deepEqual(await readBudget(fixture.db),{initialized:false,attempts:0,reservedCents:0});
  await assert.rejects(reserveGuidance(fixture.db),rejects('budget_unavailable'));
  await initializeBudget(fixture.db);
  const ids=new Set<string>();
  for(let n=1;n<=100;n++){const receipt=await reserveGuidance(fixture.db);assert.equal(receipt.attempt,n);assert.equal(receipt.reservationCents,5);ids.add(receipt.id);}
  assert.equal(ids.size,100);assert.deepEqual(await readBudget(fixture.db),{initialized:true,attempts:100,reservedCents:500});
  await assert.rejects(reserveGuidance(fixture.db),rejects('budget_exhausted'));
  await initializeBudget(fixture.db);assert.equal((await readBudget(fixture.db)).reservedCents,500);
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_test_attempts WHERE scope=?').get(BUDGET_SCOPE)!.n,100);
});

test('the durable setup marker prevents enable from refilling a missing ledger',async t=>{
  const fixture=createSharedD1();t.after(fixture.close);await initializeBudget(fixture.db);
  fixture.sqlite.prepare('DELETE FROM ai_test_budget WHERE scope=?').run(BUDGET_SCOPE);
  await assert.rejects(readBudget(fixture.db),rejects('budget_unavailable'));
  await assert.rejects(initializeBudget(fixture.db),rejects('budget_unavailable'));
  await assert.rejects(reserveGuidance(fixture.db),rejects('budget_unavailable'));
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_test_budget').get()!.n,0);
});

test('orphan rows and inconsistent receipts fail closed without automatic repair or top-up',async t=>{
  const orphan=createSharedD1();t.after(orphan.close);
  orphan.sqlite.prepare('INSERT INTO ai_test_budget(scope,cap_cents,reserved_cents,attempts,updated_at) VALUES(?,500,0,0,0)').run(BUDGET_SCOPE);
  await assert.rejects(initializeBudget(orphan.db),rejects('budget_unavailable'));
  const broken=createSharedD1();t.after(broken.close);await initializeBudget(broken.db);await reserveGuidance(broken.db);
  broken.sqlite.prepare('DELETE FROM ai_test_attempts WHERE scope=?').run(BUDGET_SCOPE);
  await assert.rejects(reserveGuidance(broken.db),rejects('budget_unavailable'));
  assert.equal(broken.sqlite.prepare('SELECT reserved_cents FROM ai_test_budget').get()!.reserved_cents,5);
});
