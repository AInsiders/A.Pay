/**
 * Paycheck-to-paycheck plan.
 *
 * The schedule is a running balance: cash on hand, then each deposit,
 * then what that money has to cover before the next deposit. Required
 * items can spend the cushion. Everyday extras wait when paying them
 * would drop the account under the cushion, or when the account is short.
 */

const SCENARIO_FIELD = {
  LOWEST_INCOME: "minimum",
  MOST_EFFICIENT: "target",
  HIGHEST_INCOME: "maximum",
};

export const SCENARIO_LABELS = {
  LOWEST_INCOME: "Lowest",
  MOST_EFFICIENT: "Expected",
  HIGHEST_INCOME: "Highest",
};

export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function money(n) {
  return round2(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function isoOf(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso, n) {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() + n);
  return isoOf(date);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export function formatDay(iso) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseDate(iso));
}

export function formatMonth(iso) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDate(`${iso.slice(0, 7)}-01`));
}

export function blankSnapshot(today = todayISO()) {
  return {
    today,
    accounts: [],
    incomeSources: [],
    paychecks: [],
    bills: [],
    debts: [],
    expenses: [],
    housingConfig: null,
    housingBuckets: [],
    deductionRules: [],
    categories: [],
    labels: [],
    payments: [],
    settings: {
      targetBuffer: 50,
      planningStyle: "BALANCED",
      payoffMode: "SNOWBALL",
      housingPaymentMode: "MINIMUM_CURRENT",
      selectedScenarioMode: "MOST_EFFICIENT",
    },
  };
}

function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function clampDay(year, monthIndex, day) {
  const dim = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(day, dim);
}

/** Inclusive start, exclusive end. */
export function occurrences(rule, start, endExclusive) {
  if (!rule || !start || !endExclusive || start >= endExclusive) return [];
  const type = rule.type || "MONTHLY";
  if (type === "ONE_TIME" || type === "ONCE") {
    const date = rule.anchorDate || rule.date;
    return date && date >= start && date < endExclusive ? [date] : [];
  }
  if (type === "MONTHLY") {
    const day = rule.dayOfMonth || (rule.anchorDate ? parseDate(rule.anchorDate).getUTCDate() : parseDate(start).getUTCDate());
    const out = [];
    let cursor = parseDate(start);
    let y = cursor.getUTCFullYear();
    let m = cursor.getUTCMonth();
    for (let i = 0; i < 36 && out.length < 24; i++) {
      const date = isoOf(new Date(Date.UTC(y, m, clampDay(y, m, day))));
      if (date >= endExclusive) break;
      if (date >= start) out.push(date);
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }
  if (type === "SEMI_MONTHLY") {
    const days = (rule.semiMonthlyDays || [1, 15]).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    const out = [];
    let cursor = parseDate(start);
    let y = cursor.getUTCFullYear();
    let m = cursor.getUTCMonth();
    for (let i = 0; i < 36; i++) {
      for (const day of days) {
        const date = isoOf(new Date(Date.UTC(y, m, clampDay(y, m, day))));
        if (date >= endExclusive) return out;
        if (date >= start) out.push(date);
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }
  const interval = type === "WEEKLY" ? 7 : type === "BIWEEKLY" ? 14 : Math.max(1, Number(rule.intervalDays) || 7);
  const anchor = rule.anchorDate || start;
  let first = anchor;
  if (first < start) {
    const steps = Math.ceil(daysBetween(anchor, start) / interval);
    first = addDays(anchor, steps * interval);
  }
  const out = [];
  for (let date = first, guard = 0; date < endExclusive && guard < 400; date = addDays(date, interval), guard++) {
    if (date >= start) out.push(date);
  }
  return out;
}

function incomeGross(source, scenario) {
  const range = source.amountRange || {};
  if (source.forecastAmountMode === "FIXED") {
    return round2(range.target ?? range.minimum ?? range.maximum ?? source.amount ?? 0);
  }
  const field = SCENARIO_FIELD[scenario] || "target";
  const fallback = range.target ?? range.minimum ?? range.maximum ?? source.amount ?? 0;
  return round2(range[field] ?? fallback);
}

function deductionLines(source, gross, rules) {
  const lines = [];
  for (const rule of rules || []) {
    if (rule.isEnabledByDefault === false || rule.status === "DISABLED") continue;
    if (rule.scope === "INCOME_SOURCE" && rule.incomeSourceId && rule.incomeSourceId !== source.id) continue;
    if (rule.incomeSourceId && rule.scope !== "INCOME_SOURCE" && rule.incomeSourceId !== source.id) continue;
    const listed = source.deductionRuleIds;
    if (Array.isArray(listed) && listed.length > 0 && rule.id && !listed.includes(rule.id) && rule.incomeSourceId !== source.id) {
      continue;
    }
    const amount = rule.valueType === "PERCENTAGE"
      ? round2(gross * Number(rule.percentage || 0))
      : round2(rule.fixedAmount || 0);
    if (amount <= 0) continue;
    lines.push({ name: rule.name || "Deduction", amount });
  }
  return lines;
}

function paidSet(snapshot) {
  return new Set((snapshot.payments || []).map((p) => p.key));
}

function pushItem(items, item, paid) {
  if (!item.date || !(item.amount > 0)) return;
  if (paid.has(item.key)) return;
  items.push({
    required: true,
    overdue: false,
    priority: 6,
    partial: false,
    ...item,
    amount: round2(item.amount),
  });
}

function collectObligations(snapshot, asOf, horizonEnd, firstPay) {
  const paid = paidSet(snapshot);
  const items = [];
  const place = (due) => {
    if (!firstPay) return due < asOf ? asOf : due;
    return due <= firstPay ? firstPay : due;
  };

  for (const expense of snapshot.expenses || []) {
    if (expense.isActive === false) continue;
    const rule = expense.recurringRule || { type: "MONTHLY", anchorDate: asOf, dayOfMonth: 1 };
    for (const date of occurrences(rule, asOf, horizonEnd)) {
      pushItem(items, {
        key: `expense:${expense.id}:${date}`,
        date: place(date),
        due: date,
        overdue: date < asOf,
        kind: "expense",
        label: expense.name || "Expense",
        amount: expense.amount,
        required: expense.isEssential !== false,
        priority: expense.isEssential === false ? 6 : 1,
        partial: true,
        ref: { type: "expense", id: expense.id },
      }, paid);
    }
  }

  for (const bill of snapshot.bills || []) {
    if (bill.isActive === false) continue;
    const amount = bill.currentAmountDue ?? bill.amountDue ?? bill.minimumDue ?? 0;
    const rule = bill.recurringRule || { type: "ONE_TIME", anchorDate: asOf };
    for (const date of occurrences(rule, asOf, horizonEnd)) {
      const essential = bill.isEssential === true;
      pushItem(items, {
        key: `bill:${bill.id}:${date}`,
        date: place(date),
        due: date,
        overdue: date < asOf,
        kind: "bill",
        label: bill.name || "Bill",
        detail: bill.category || "",
        amount,
        required: essential,
        priority: essential ? 2 : 6,
        ref: { type: "bill", id: bill.id },
      }, paid);
    }
  }

  for (const debt of snapshot.debts || []) {
    const installments = debt.installments || [];
    if (installments.length) {
      for (const inst of installments) {
        if (!inst.dueDate || inst.dueDate >= horizonEnd) continue;
        pushItem(items, {
          key: `installment:${inst.id}`,
          date: place(inst.dueDate),
          due: inst.dueDate,
          overdue: inst.dueDate < asOf,
          kind: "debt",
          label: inst.label || debt.name || "Debt payment",
          detail: debt.name || "",
          amount: inst.amount,
          required: true,
          priority: 3,
          partial: true,
          ref: { type: "installment", debtId: debt.id, id: inst.id },
        }, paid);
      }
    } else if (debt.requiredDueDate && debt.minimumDue > 0 && debt.requiredDueDate < horizonEnd) {
      pushItem(items, {
        key: `debt:${debt.id}:${debt.requiredDueDate}`,
        date: place(debt.requiredDueDate),
        due: debt.requiredDueDate,
        overdue: debt.requiredDueDate < asOf,
        kind: "debt",
        label: debt.name || "Debt payment",
        amount: debt.minimumDue,
        required: true,
        priority: 3,
        partial: true,
        ref: { type: "debt", id: debt.id },
      }, paid);
    }
  }

  const cfg = snapshot.housingConfig;
  const mode = snapshot.settings?.housingPaymentMode || "MINIMUM_CURRENT";
  const coveredMonths = new Set();
  for (const bucket of snapshot.housingBuckets || []) {
    if (bucket.monthKey) coveredMonths.add(bucket.monthKey);
    const remaining = round2(Number(bucket.amountDue || 0) - Number(bucket.amountPaid || 0));
    if (remaining <= 0 || !bucket.dueDate || bucket.dueDate >= horizonEnd) continue;
    const current = bucket.isCurrentBucket === true;
    const when = place(bucket.dueDate);
    const overdue = bucket.dueDate < asOf;
    if (current && mode === "MINIMUM_CURRENT") {
      const minimum = round2(Math.min(remaining, Number(cfg?.minimumAcceptablePayment ?? remaining)));
      const extra = round2(remaining - minimum);
      if (minimum > 0) {
        pushItem(items, {
          key: `housing:${bucket.id}:minimum`,
          date: when,
          due: bucket.dueDate,
          overdue,
          kind: "housing",
          label: `${bucket.label || "Rent"} minimum`,
          amount: minimum,
          required: true,
          priority: 4,
          partial: true,
          ref: { type: "housing", id: bucket.id, part: "minimum" },
        }, paid);
      }
      if (extra > 0) {
        pushItem(items, {
          key: `housing:${bucket.id}:extra`,
          date: when,
          due: bucket.dueDate,
          overdue,
          kind: "housing",
          label: `${bucket.label || "Rent"} extra`,
          detail: "Optional top-up to the full rent",
          amount: extra,
          required: false,
          priority: 7,
          ref: { type: "housing", id: bucket.id, part: "extra" },
        }, paid);
      }
    } else {
      pushItem(items, {
        key: current ? `housing:${bucket.id}:full` : `housing:${bucket.id}:arrears`,
        date: when,
        due: bucket.dueDate,
        overdue,
        kind: current ? "housing" : "arrears",
        label: bucket.label || (current ? "Rent" : "Rent arrears"),
        amount: remaining,
        required: true,
        priority: current ? 4 : 5,
        partial: true,
        ref: { type: "housing", id: bucket.id, part: current ? "full" : "arrears" },
      }, paid);
    }
  }

  if (cfg && Number(cfg.currentMonthlyRent) > 0) {
    const start = parseDate(asOf);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    for (let i = 0; i < 18; i++) {
      const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
      const due = isoOf(new Date(Date.UTC(y, m, clampDay(y, m, Number(cfg.rentDueDay) || 1))));
      if (due >= horizonEnd) break;
      if (!coveredMonths.has(monthKey) && due >= asOf) {
        const isCurrentMonth = monthKey === asOf.slice(0, 7);
        const full = round2(cfg.currentMonthlyRent);
        if (isCurrentMonth && mode === "MINIMUM_CURRENT") {
          const minimum = round2(Math.min(full, Number(cfg.minimumAcceptablePayment ?? full)));
          pushItem(items, {
            key: `rent:${monthKey}:minimum`,
            date: place(due),
            due,
            kind: "housing",
            label: "Rent minimum",
            amount: minimum,
            required: true,
            priority: 4,
            partial: true,
            ref: { type: "generated-rent", monthKey, part: "minimum" },
          }, paid);
          const extra = round2(full - minimum);
          if (extra > 0) {
            pushItem(items, {
              key: `rent:${monthKey}:extra`,
              date: place(due),
              due,
              kind: "housing",
              label: "Rent extra",
              amount: extra,
              required: false,
              priority: 7,
              ref: { type: "generated-rent", monthKey, part: "extra" },
            }, paid);
          }
        } else {
          pushItem(items, {
            key: `rent:${monthKey}`,
            date: place(due),
            due,
            kind: "housing",
            label: `Rent ${monthKey}`,
            amount: full,
            required: true,
            priority: 4,
            partial: true,
            ref: { type: "generated-rent", monthKey, part: "full" },
          }, paid);
        }
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
  }

  return items;
}

function collectPaychecks(snapshot, asOf, lookEnd, scenario) {
  const events = [];
  const seen = new Set();
  const add = (date, source, gross) => {
    if (!date || date < asOf || date >= lookEnd) return;
    const key = `${source.id}:${date}`;
    if (seen.has(key)) return;
    seen.add(key);
    const inputMode = source.inputMode || "GROSS";
    const lines = inputMode === "NET" ? [] : deductionLines(source, gross, snapshot.deductionRules);
    const deduction = round2(lines.reduce((sum, line) => sum + line.amount, 0));
    const net = round2(Math.max(0, gross - deduction));
    events.push({
      date,
      sourceId: source.id,
      name: source.name || "Paycheck",
      gross: round2(gross),
      deduction,
      deductionLines: lines,
      net,
    });
  };

  for (const source of snapshot.incomeSources || []) {
    if (source.isActive === false) continue;
    const gross = incomeGross(source, scenario);
    if (source.isManualOnly) {
      add(source.nextExpectedPayDate, source, gross);
      continue;
    }
    const rule = source.recurringRule || (source.nextExpectedPayDate
      ? { type: "ONE_TIME", anchorDate: source.nextExpectedPayDate }
      : null);
    if (rule) {
      for (const date of occurrences(rule, asOf, lookEnd)) add(date, source, gross);
    }
    add(source.nextExpectedPayDate, source, gross);
  }

  for (const check of snapshot.paychecks || []) {
    const source = (snapshot.incomeSources || []).find((s) => s.id === check.incomeSourceId) || {
      id: check.incomeSourceId || check.id || "paycheck",
      name: check.name || "Paycheck",
      inputMode: "NET",
    };
    const gross = round2(check.netAmount ?? check.amount ?? check.grossAmount ?? incomeGross(source, scenario));
    add(check.date || check.payDate, source, gross);
  }

  events.sort((a, b) => cmp(a.date, b.date) || cmp(a.name, b.name));
  return events;
}

function lineDetail(item) {
  const bits = [];
  if (item.overdue && item.due) bits.push(`overdue since ${formatDay(item.due)}`);
  else if (item.due && item.due !== item.date) bits.push(`due ${formatDay(item.due)}`);
  if (item.detail) bits.push(item.detail);
  return bits.join(" · ");
}

function statusFor(short, cushion, buffer) {
  if (short > 0.009) {
    return { status: "short", statusLabel: "Short this check", statusDetail: `${money(short)} still unpaid before the next deposit.` };
  }
  if (buffer > 0 && cushion + 0.009 < buffer) {
    return {
      status: "tight",
      statusLabel: "Bills fit, cushion does not",
      statusDetail: `Bills on this stretch are covered. The cushion is ${money(cushion)} of the ${money(buffer)} you wanted left over.`,
    };
  }
  return {
    status: "feasible",
    statusLabel: "This check covers what's due",
    statusDetail: "Required bills, essentials, debt, and rent on this stretch are covered.",
  };
}

function buildSuggestions(cycles, snapshot) {
  const suggestions = [];
  const housingShort = cycles.some((cycle) => cycle.lines.some((line) => (line.kind === "housing" || line.kind === "arrears") && line.short > 0));
  if (housingShort) {
    const winners = [];
    for (const cycle of cycles) {
      for (const line of cycle.lines) {
        if (line.kind === "expense" && line.priority === 1 && line.paid > 0 && !winners.includes(line.label)) {
          winners.push(line.label);
        }
      }
    }
    if (winners.length) {
      suggestions.push({
        title: "Rent is waiting behind everyday spending",
        detail: `${winners.join(", ")} ${winners.length === 1 ? "is" : "are"} marked essential, so ${winners.length === 1 ? "it is" : "they are"} paid before rent. Turn essential off on anything that should wait.`,
      });
    }
  }

  const delayed = [];
  for (const cycle of cycles.slice(0, 3)) {
    for (const line of cycle.lines) {
      if (line.state === "delay") delayed.push(`${line.label} ${money(line.amount)}`);
    }
  }
  if (delayed.length) {
    suggestions.push({
      title: "Leave these until the bills fit",
      detail: delayed.slice(0, 6).join(", ") + (delayed.length > 6 ? ", and more." : "."),
    });
  }

  const revolving = (snapshot.debts || []).filter((d) => d.reborrowAllowed);
  if (revolving.length) {
    const anyShort = cycles.some((cycle) => cycle.short > 0);
    const name = revolving[0].name || "This credit line";
    const cap = money(revolving[0].maxSafeReborrowAmount || revolving[0].revolvingSettings?.maxSafeReborrowAmount || 0);
    suggestions.push({
      title: "Don't borrow against this plan",
      detail: anyShort
        ? `${name} lists up to ${cap} as a re-borrow cap, but this plan is already short. Borrowing stays off.`
        : `${name} stays unavailable to re-borrow until the balance is trending down. The cap on file is ${cap}.`,
    });
  }
  return suggestions;
}

export function buildPlan(snapshot, options = {}) {
  const asOf = options.asOf || snapshot?.today || todayISO();
  const scenario = options.scenario || snapshot?.settings?.selectedScenarioMode || "MOST_EFFICIENT";
  const buffer = round2(snapshot?.settings?.targetBuffer ?? 0);
  const lookEnd = addDays(asOf, 370);
  const candidates = collectPaychecks(snapshot || {}, asOf, lookEnd, scenario);
  const fourth = candidates[3]?.date;
  const horizonDays = options.horizonDays ?? 45;
  const horizonFloor = addDays(asOf, horizonDays + 1);
  const horizonEnd = fourth && addDays(fourth, 1) > horizonFloor ? addDays(fourth, 1) : horizonFloor;
  const paychecks = candidates.filter((check) => check.date < horizonEnd);
  const firstPay = paychecks[0]?.date || null;
  const obligations = collectObligations(snapshot || {}, asOf, horizonEnd, firstPay);

  const startingCash = round2((snapshot?.accounts || [])
    .filter((account) => account.includeInPlanning !== false)
    .reduce((sum, account) => sum + Number(account.availableBalance ?? account.currentBalance ?? 0), 0));

  if (!paychecks.length) {
    return {
      asOf,
      horizonEnd,
      scenario,
      scenarioLabel: SCENARIO_LABELS[scenario] || "Expected",
      startingCash,
      buffer,
      housingMode: snapshot?.settings?.housingPaymentMode || "MINIMUM_CURRENT",
      status: "needs_setup",
      statusLabel: "Needs a paycheck",
      statusDetail: "Add an income source before this can tell you what to pay.",
      paychecks: [],
      cycles: [],
      waiting: obligations,
      suggestions: [],
      calendar: calendarFrom(obligations, []),
      debts: debtSummary(snapshot),
      reborrow: null,
    };
  }

  const events = [
    ...paychecks.map((check) => ({ ...check, kind: "payday", sort: 0 })),
    ...obligations.map((item) => ({ ...item, sort: 1 })),
  ];
  events.sort((a, b) => cmp(a.date, b.date) || cmp(a.sort, b.sort) || cmp(a.priority ?? 0, b.priority ?? 0) || cmp(a.label || a.name || "", b.label || b.name || ""));

  let balance = startingCash;
  const cycles = [];
  let current = null;

  const openCycle = (check, opening) => {
    current = {
      index: cycles.length,
      start: check.date,
      end: horizonEnd,
      paycheck: check,
      openingBalance: round2(opening),
      lines: [],
      requiredTotal: 0,
      covered: 0,
      short: 0,
      balanceAfter: round2(opening + check.net),
      cushion: 0,
      status: "feasible",
      statusLabel: "",
      statusDetail: "",
    };
    cycles.push(current);
    const withheld = check.deductionLines.map((line) => `${line.name} ${money(line.amount)}`).join(", ");
    current.lines.push({
      date: check.date,
      kind: "payday",
      label: check.name,
      detail: withheld
        ? `${money(check.gross)} before ${withheld}`
        : `${money(check.gross)} deposit`,
      amount: check.net,
      paid: check.net,
      short: 0,
      state: "deposit",
      required: true,
      priority: 0,
      ref: { type: "income", id: check.sourceId },
    });
  };

  for (const event of events) {
    if (event.kind === "payday") {
      if (current) current.end = event.date;
      openCycle(event, balance);
      balance = round2(balance + event.net);
      current.balanceAfter = balance;
      continue;
    }
    if (!current) continue;
    const required = event.required !== false;
    let paid = 0;
    let state = "unpaid";
    if (!required) {
      if (balance - event.amount >= buffer - 0.001) {
        paid = event.amount;
        balance = round2(balance - paid);
        state = "pay";
      } else {
        state = "delay";
      }
    } else if (event.partial) {
      paid = round2(Math.min(Math.max(balance, 0), event.amount));
      balance = round2(balance - paid);
      state = paid >= event.amount - 0.001 ? "pay" : paid > 0 ? "partial" : "unpaid";
    } else if (balance >= event.amount - 0.001) {
      paid = event.amount;
      balance = round2(balance - paid);
      state = "pay";
    } else {
      state = "unpaid";
    }
    const short = required ? round2(Math.max(0, event.amount - paid)) : 0;
    if (required) {
      current.requiredTotal = round2(current.requiredTotal + event.amount);
      current.covered = round2(current.covered + paid);
      current.short = round2(current.short + short);
    }
    current.balanceAfter = balance;
    current.lines.push({
      date: event.date,
      due: event.due,
      overdue: event.overdue,
      kind: event.kind,
      label: event.label,
      detail: lineDetail(event),
      amount: event.amount,
      paid,
      short,
      state,
      required,
      priority: event.priority,
      key: event.key,
      ref: event.ref,
    });
  }

  for (const cycle of cycles) {
    cycle.cushion = cycle.short > 0 ? 0 : round2(Math.min(buffer, Math.max(cycle.balanceAfter, 0)));
    Object.assign(cycle, statusFor(cycle.short, cycle.cushion, buffer));
  }

  const anyShort = cycles.some((cycle) => cycle.short > 0);
  const overall = !anyShort && cycles.every((cycle) => cycle.status === "feasible")
    ? statusFor(0, buffer, buffer)
    : anyShort
      ? {
          status: "short",
          statusLabel: "Short before everything is covered",
          statusDetail: `${money(cycles.reduce((sum, cycle) => sum + cycle.short, 0))} of required payments do not fit the deposits in this horizon.`,
        }
      : {
          status: "tight",
          statusLabel: "Bills fit, cushion does not",
          statusDetail: "Required payments fit. At least one stretch ends below the cushion you set.",
        };

  return {
    asOf,
    horizonEnd,
    scenario,
    scenarioLabel: SCENARIO_LABELS[scenario] || "Expected",
    startingCash,
    buffer,
    housingMode: snapshot?.settings?.housingPaymentMode || "MINIMUM_CURRENT",
    ...overall,
    paychecks,
    cycles,
    waiting: [],
    suggestions: buildSuggestions(cycles, snapshot || {}),
    calendar: calendarFrom(obligations, paychecks),
    debts: debtSummary(snapshot),
    reborrow: null,
  };
}

function calendarFrom(obligations, paychecks) {
  const byDate = new Map();
  const add = (date, item) => {
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(item);
  };
  for (const check of paychecks) {
    add(check.date, { label: check.name, amount: check.net, kind: "payday", detail: "Deposit" });
  }
  for (const item of obligations) {
    add(item.date, { label: item.label, amount: item.amount, kind: item.kind, detail: lineDetail(item) });
  }
  return [...byDate.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([date, items]) => ({ date, items }));
}

function debtSummary(snapshot) {
  return (snapshot?.debts || []).map((debt) => {
    const scheduled = round2((debt.installments || []).reduce((sum, inst) => sum + Number(inst.amount || 0), 0));
    const balance = round2(debt.currentBalance || 0);
    return {
      id: debt.id,
      name: debt.name || "Debt",
      balance,
      scheduled,
      leftAfterScheduled: round2(balance - scheduled),
    };
  });
}

export function paymentKeyFor(line) {
  return line.key || null;
}

export function markPaid(snapshot, key, paidAt) {
  if (!key) return snapshot;
  const payments = [...(snapshot.payments || [])];
  if (!payments.some((p) => p.key === key)) payments.push({ key, paidAt: paidAt || todayISO() });
  return { ...snapshot, payments };
}

export function forgiveBefore(snapshot, asOf) {
  const next = { ...snapshot, payments: [...(snapshot.payments || [])] };
  const keys = new Set(next.payments.map((p) => p.key));
  const add = (key) => {
    if (!key || keys.has(key)) return;
    keys.add(key);
    next.payments.push({ key, paidAt: asOf });
  };
  for (const bucket of snapshot.housingBuckets || []) {
    if (bucket.dueDate && bucket.dueDate < asOf) {
      add(`housing:${bucket.id}:minimum`);
      add(`housing:${bucket.id}:extra`);
      add(`housing:${bucket.id}:full`);
      add(`housing:${bucket.id}:arrears`);
    }
  }
  for (const debt of snapshot.debts || []) {
    for (const inst of debt.installments || []) {
      if (inst.dueDate && inst.dueDate < asOf) add(`installment:${inst.id}`);
    }
    if (!debt.installments?.length && debt.requiredDueDate && debt.requiredDueDate < asOf) {
      add(`debt:${debt.id}:${debt.requiredDueDate}`);
    }
  }
  return next;
}

export function newId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}
