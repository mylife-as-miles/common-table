import test from "node:test";
import assert from "node:assert/strict";
import { parseEditorDraft } from "../src/collaboration/useTableExperience.ts";
import { sharedPreferencesOnly } from "../src/collaboration/types.ts";
import { venues } from "../src/domain/data.ts";

test("shared preference transport strips app seat identity fields while retaining the person's choices", () => {
  const person = { id: "you", name: "Alice", color: "#a46c49", userId: "forged-target", budget: 55, tastes: ["Italian"], restrictions: ["Vegetarian"] };
  const body = sharedPreferencesOnly(person);
  assert.deepEqual(body, { budget: 55, tastes: ["Italian"], restrictions: ["Vegetarian"] });
  body.tastes.push("Seasonal"); assert.deepEqual(person.tastes, ["Italian"]);
});

test("device draft hydration rejects corrupt preferences and never restores a forged saved claim", () => {
  for (const preferences of [{ tastes: [123], restrictions: [], budget: 65 }, { tastes: [], restrictions: [], budget: "65" }, { tastes: [], restrictions: [], budget: 0 }]) assert.equal(parseEditorDraft({ version: 3, preferences }), null);
  const draft = parseEditorDraft({ version: 3, plan: { venueId: "juniper", venueSnapshot: { ...venues[0], price: 0 }, date: "2099-04-12", time: "19:00", note: "Dinner", saved: true, approvals: ["someone-else"] } });
  assert.equal(draft?.plan?.saved, false);
  assert.equal(draft?.plan?.venueSnapshot?.price, 48);
  assert.equal((draft?.plan as unknown as Record<string, unknown>).approvals, undefined);
  assert.equal(parseEditorDraft({ version: 3, plan: { ...draft!.plan, venueId: "unknown" } }), null);
});
