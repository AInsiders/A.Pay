import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addDays,
  blankSnapshot,
  buildPlan,
  forgiveBefore,
  markPaid,
  money,
  occurrences,
} from "./planner.js";

const backup = JSON.parse(readFileSync(new URL("../billpayer-full-financial-dataset-backup.json", import.meta.url), "utf8"));

test("an empty plan is not called feasible or on track", () => {
  const plan = buildPlan(blankSnapshot("2026-03-31"), { asOf: "2026-03-31" });
  assert.equal(plan.status, "needs_setup");
  assert.equal(plan.cycles.length, 0);
  assert.match(plan.statusLabel, /paycheck/i);
  assert.doesNotMatch(`${plan.status} ${plan.statusLabel} ${plan.statusDetail}`, /feasible|on track/i);
});

test("sample paycheck uses the expected net after tithe and is honestly short", () => {
  const plan = buildPlan(backup.snapshot, { asOf: "2026-03-31", scenario: "MOST_EFFICIENT" });
  assert.equal(plan.paychecks[0].date, "2026-04-03");
  assert.equal(plan.paychecks[0].name, "Person 1 Weekly Pay");
  assert.equal(plan.paychecks[0].gross, 450);
  assert.equal(plan.paychecks[0].deduction, 45);
  assert.equal(plan.paychecks[0].net, 405);
  assert.equal(plan.startingCash, 20);
  const first = plan.cycles[0];
  assert.equal(first.end, "2026-04-07");
  assert.equal(first.requiredTotal, 820);
  assert.equal(first.covered, 425);
  assert.equal(first.short, 395);
  assert.equal(first.status, "short");
  assert.doesNotMatch(first.statusLabel, /on track/i);
  assert.equal(plan.status, "short");

  const labels = first.lines.map((line) => `${line.label}:${line.state}:${line.paid}`);
  assert.deepEqual(labels.slice(0, 5), [
    "Person 1 Weekly Pay:deposit:405",
    "Cigarettes:pay:70",
    "Food:pay:70",
    "Gas:pay:80",
    "April current rent minimum:partial:205",
  ]);
  const arrears = first.lines.find((line) => line.label === "March back pay");
  assert.equal(arrears.state, "unpaid");
  assert.equal(arrears.short, 300);
  const cursor = first.lines.find((line) => line.label === "Cursor");
  assert.equal(cursor.state, "delay");
  assert.equal(cursor.required, false);
  assert.ok(plan.suggestions.some((item) => /rent is waiting/i.test(item.title)));
});

test("lowest and highest income change the deposit", () => {
  const low = buildPlan(backup.snapshot, { asOf: "2026-03-31", scenario: "LOWEST_INCOME" });
  const high = buildPlan(backup.snapshot, { asOf: "2026-03-31", scenario: "HIGHEST_INCOME" });
  assert.equal(low.paychecks[0].gross, 400);
  assert.equal(low.paychecks[0].net, 360);
  assert.equal(low.cycles[0].short, 440);
  assert.equal(high.paychecks[0].gross, 500);
  assert.equal(high.paychecks[0].net, 450);
  assert.equal(high.cycles[0].short, 350);
});

test("verizon is on the check that lands before its due date", () => {
  const plan = buildPlan(backup.snapshot, { asOf: "2026-03-31" });
  const cycle = plan.cycles.find((item) => item.lines.some((line) => line.label === "Verizon"));
  assert.equal(cycle.start, "2026-04-17");
  const verizon = cycle.lines.find((line) => line.label === "Verizon");
  assert.equal(verizon.due, "2026-04-18");
  assert.equal(verizon.amount, 255);
  assert.equal(verizon.state, "pay");
});

test("marking arrears paid removes them from the gap", () => {
  const paid = markPaid(backup.snapshot, "housing:rent-march-back-pay:arrears", "2026-03-31");
  const plan = buildPlan(paid, { asOf: "2026-03-31" });
  assert.equal(plan.cycles[0].short, 95);
  assert.equal(plan.cycles[0].lines.some((line) => line.label === "March back pay"), false);
});

test("old dated items can be cleared without deleting the backup", () => {
  const cleared = forgiveBefore(backup.snapshot, "2026-11-10");
  const plan = buildPlan(cleared, { asOf: "2026-11-10", scenario: "MOST_EFFICIENT" });
  assert.equal(plan.status === "needs_setup", false);
  assert.equal(plan.cycles[0].lines.some((line) => line.kind === "arrears" || line.kind === "debt"), false);
  assert.ok(plan.paychecks[0].date >= "2026-11-10");
});

test("monthly dates clamp to the end of a short month", () => {
  assert.deepEqual(
    occurrences({ type: "MONTHLY", dayOfMonth: 31, anchorDate: "2026-01-31" }, "2026-02-01", "2026-03-01"),
    ["2026-02-28"],
  );
  assert.deepEqual(
    occurrences({ type: "EVERY_X_DAYS", intervalDays: 28, anchorDate: "2026-04-07" }, "2026-03-31", "2026-05-16"),
    ["2026-04-07", "2026-05-05"],
  );
});

test("money format stays a normal dollar amount", () => {
  assert.equal(money(405), "$405.00");
  assert.equal(money(-12.5), "-$12.50");
  assert.equal(addDays("2026-03-31", 45), "2026-05-15");
});
