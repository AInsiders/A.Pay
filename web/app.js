import {
  addDays,
  blankSnapshot,
  buildPlan,
  formatDay,
  formatMonth,
  forgiveBefore,
  markPaid,
  money,
  newId,
  parseDate,
  todayISO,
} from "./planner.js";

const STORAGE_KEY = "apay-planner-v1";

const FREQUENCIES = [
  ["WEEKLY", "Every week"],
  ["BIWEEKLY", "Every 2 weeks"],
  ["SEMI_MONTHLY", "Twice a month"],
  ["MONTHLY", "Every month"],
  ["EVERY_X_DAYS", "Every few days"],
  ["ONE_TIME", "One time"],
];

let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.snapshot) return { ...freshState(), ...saved, dialog: null, pendingDelete: null };
  } catch {
    // Ignore a damaged saved plan and start clean.
  }
  return freshState();
}

function freshState() {
  return {
    snapshot: blankSnapshot(),
    asOfChoice: "today",
    view: "home",
    cycleIndex: 0,
    month: todayISO().slice(0, 7),
    selectedDay: null,
    dialog: null,
    pendingDelete: null,
    sampleError: "",
    focusHeading: false,
  };
}

function save() {
  const { dialog, pendingDelete, focusHeading, sampleError, ...rest } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
}

function planAsOf() {
  if (state.asOfChoice === "snapshot" && state.snapshot.today) return state.snapshot.today;
  return todayISO();
}

function currentPlan() {
  return buildPlan(state.snapshot, { asOf: planAsOf() });
}

function commit(snapshot, extra = {}) {
  state.snapshot = snapshot;
  Object.assign(state, extra);
  save();
  render();
}

const h = (tag, attrs = {}, kids = []) => {
  const node = document.createElement(tag);
  const { value, checked, ...rest } = attrs;
  for (const [key, val] of Object.entries(rest)) {
    if (val == null || val === false) continue;
    if (key === "class") node.className = val;
    else if (key.startsWith("on") && typeof val === "function") node.addEventListener(key.slice(2).toLowerCase(), val);
    else node.setAttribute(key, val === true ? "" : String(val));
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  if (value != null && "value" in node) node.value = value;
  if (checked != null) node.checked = checked;
  return node;
};

const icon = (d) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
};

const ICONS = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  plan: "M5 6h14M5 12h14M5 18h9",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  edit: "M4 20h4L18 10l-4-4L4 16z",
};

function renderNav() {
  const nav = document.querySelector(".nav");
  const items = [
    ["home", "Home", "home"],
    ["plan", "Plan", "plan"],
    ["calendar", "Calendar", "calendar"],
    ["edit", "Edit", "edit"],
  ];
  nav.replaceChildren(...items.map(([id, label]) => h("button", {
    type: "button",
    "aria-current": state.view === id ? "page" : null,
    onclick: () => setView(id),
  }, [icon(ICONS[id]), label])));
}

function setView(view) {
  state.view = view;
  state.focusHeading = true;
  state.pendingDelete = null;
  save();
  render();
}

function openDialog(type, id = null) {
  state.dialog = { type, id, error: "", draft: draftFor(type, id) };
  render();
}

function closeDialog() {
  state.dialog = null;
  render();
}

function render() {
  renderNav();
  const main = document.getElementById("main");
  let plan;
  try {
    plan = currentPlan();
  } catch (error) {
    main.replaceChildren(h("h1", {}, "The plan couldn't be built"), h("p", { class: "error" }, error.message || "Unknown error"));
    return;
  }
  if (!plan.cycles.length) state.cycleIndex = 0;
  else if (state.cycleIndex >= plan.cycles.length || state.cycleIndex < 0) state.cycleIndex = 0;
  const view = { home: renderHome, plan: renderPlan, calendar: renderCalendar, edit: renderEdit }[state.view] || renderHome;
  main.replaceChildren(view(plan));
  renderDialog();
  if (state.focusHeading) {
    const heading = main.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
    state.focusHeading = false;
  }
}

function renderHome(plan) {
  const cycle = plan.cycles[state.cycleIndex] || plan.cycles[0];
  const title = cycle ? formatDay(cycle.start) : "Add your first paycheck";
  return h("div", { class: "stack" }, [
    h("p", { class: "kicker" }, cycle ? cycle.paycheck.name : "BillPayer"),
    h("h1", {}, title),
    h("p", { class: "sub" }, cycle
      ? `Covers ${formatDay(cycle.start)} through ${formatDay(addDays(cycle.end, -1))}.`
      : "Add the paycheck that hits your account. Bills and rent come next."),
    dateBanner(),
    cycle ? statusCard(plan, cycle) : null,
    cycle ? cyclePicker(plan) : null,
    cycle && cycle.requiredTotal > 0 ? tiles(plan, cycle) : null,
    cycle ? h("p", { class: "note" }, cycleNote(plan, cycle)) : null,
    cycle ? actionList(cycle) : emptyState(),
    undoControl(),
    plan.waiting?.length ? waitingList(plan) : null,
    plan.suggestions.length ? suggestionList(plan) : null,
    cycle && hasObligations() ? h("section", { class: "stack" }, [h("h2", {}, "Adjust this plan"), controls()]) : null,
  ]);
}

function renderPlan(plan) {
  return h("div", { class: "stack" }, [
    h("h1", {}, "Every check in this stretch"),
    h("p", { class: "sub" }, plan.cycles.length
      ? `${plan.scenarioLabel} income from ${formatDay(plan.asOf)} to ${formatDay(addDays(plan.horizonEnd, -1))}.`
      : "Add income and the checks will line up here."),
    dateBanner(),
    plan.cycles.length ? controls() : null,
    plan.cycles.length ? null : emptyState(),
    undoControl(),
    ...plan.cycles.map((cycle) => h("section", { class: "stack" }, [
      h("div", { class: "section-head" }, [
        h("h2", {}, formatDay(cycle.start)),
        h("span", { class: `tag ${cycle.status}` }, cycle.statusLabel),
      ]),
      h("p", { class: "note" }, `${cycle.paycheck.name} deposits ${money(cycle.paycheck.net)}. ${cycle.statusDetail}`),
      actionList(cycle),
    ])),
    plan.debts.length ? debtBlock(plan) : null,
  ]);
}

function renderCalendar(plan) {
  const [year, month] = state.month.split("-").map(Number);
  const first = `${state.month}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startPad = parseDate(first).getUTCDay();
  const byDate = new Map(plan.calendar.map((day) => [day.date, day.items]));
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(h("span", {}, ""));
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${state.month}-${String(day).padStart(2, "0")}`;
    const items = byDate.get(iso) || [];
    const kinds = [...new Set(items.map((item) => item.kind))].slice(0, 4);
    cells.push(h("button", {
      type: "button",
      "aria-pressed": state.selectedDay === iso ? "true" : "false",
      "aria-label": `${formatDay(iso)}, ${items.length} item${items.length === 1 ? "" : "s"}`,
      onclick: () => { state.selectedDay = iso; render(); },
    }, [
      String(day),
      h("span", { class: "marks" }, kinds.map((kind) => h("i", { class: kind }))),
    ]));
  }
  const selected = state.selectedDay && state.selectedDay.startsWith(state.month)
    ? (byDate.get(state.selectedDay) || [])
    : null;
  return h("div", { class: "stack" }, [
    h("div", { class: "calendar-head" }, [
      h("button", { type: "button", class: "ghost", onclick: () => shiftMonth(-1) }, "Previous"),
      h("h1", {}, formatMonth(first)),
      h("button", { type: "button", class: "ghost", onclick: () => shiftMonth(1) }, "Next"),
    ]),
    h("div", { class: "weekdays" }, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => h("span", {}, day))),
    h("div", { class: "days" }, cells),
    selected ? dayDetail(state.selectedDay, selected) : h("p", { class: "note" }, "Pick a day to see the deposit and what it has to cover."),
  ]);
}

function shiftMonth(delta) {
  const date = parseDate(`${state.month}-01`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  state.month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  state.selectedDay = null;
  render();
}

function dayDetail(iso, items) {
  return h("section", { class: "stack" }, [
    h("h2", {}, formatDay(iso)),
    items.length ? h("ul", { class: "actions" }, items.map((item) => h("li", { class: "action" }, [
      h("b", {}, item.label),
      h("span", { class: "money" }, money(item.amount)),
      item.detail ? h("span", { class: "meta" }, item.detail) : null,
    ]))) : h("p", { class: "note" }, "Nothing is scheduled this day."),
  ]);
}

function renderEdit() {
  const snap = state.snapshot;
  return h("div", { class: "stack" }, [
    h("h1", {}, "Your records"),
    h("p", { class: "sub" }, "Changes recalculate the plan immediately. Schedules use real dates, not a code you have to type."),
    dateBanner(),
    h("div", { class: "row" }, [
      h("button", { type: "button", class: "primary", onclick: () => openDialog("income") }, "Add income"),
      h("button", { type: "button", class: "ghost", onclick: () => openDialog("bill") }, "Add bill"),
      h("button", { type: "button", class: "ghost", onclick: loadSample }, "Load sample"),
      h("button", { type: "button", class: "ghost", onclick: () => document.getElementById("import-file").click() }, "Import"),
      h("button", { type: "button", class: "ghost", onclick: exportBackup }, "Export"),
    ]),
    h("input", { id: "import-file", type: "file", accept: "application/json,.json", hidden: true, onchange: importBackup }),
    state.sampleError ? h("p", { class: "error" }, state.sampleError) : null,
    recordSection("Accounts", "account", snap.accounts, (item) => `${money(item.availableBalance ?? item.currentBalance ?? 0)} available`),
    recordSection("Income", "income", snap.incomeSources, (item) => incomeSummary(item)),
    recordSection("Bills", "bill", snap.bills, (item) => `${money(item.amountDue)} · ${frequencyLabel(item.recurringRule)}`),
    recordSection("Everyday costs", "expense", snap.expenses, (item) => `${money(item.amount)} · ${item.isEssential === false ? "Can wait" : "Essential"}`),
    recordSection("Debts", "debt", snap.debts, (item) => `${money(item.currentBalance)} balance · ${(item.installments || []).length} payments`),
    housingEditor(),
    recordSection("Housing buckets", "housing", snap.housingBuckets, (item) => `${money(Math.max(0, (item.amountDue || 0) - (item.amountPaid || 0)))} left · due ${item.dueDate || "unscheduled"}`),
    recordSection("Deductions", "deduction", snap.deductionRules, (item) => deductionSummary(item)),
    resetRow(),
  ]);
}

function recordSection(title, type, items, detail) {
  return h("section", { class: "stack" }, [
    h("div", { class: "section-head" }, [
      h("h2", {}, title),
      h("button", { type: "button", class: "ghost", onclick: () => openDialog(type) }, "Add"),
    ]),
    items?.length ? h("div", { class: "list" }, items.map((item) => recordRow(type, item, detail(item)))) : h("p", { class: "note" }, "Nothing here yet."),
  ]);
}

function recordRow(type, item, detail) {
  const token = `${type}:${item.id}`;
  const confirming = state.pendingDelete === token;
  return h("article", { class: "record" }, [
    h("b", {}, item.name || item.label || "Untitled"),
    h("span", { class: "meta" }, detail),
    h("div", { class: "buttons" }, confirming
      ? [
          h("span", {}, "Delete this?"),
          h("button", { type: "button", class: "danger", onclick: () => removeRecord(type, item.id) }, "Delete"),
          h("button", { type: "button", class: "ghost", onclick: () => { state.pendingDelete = null; render(); } }, "Keep"),
        ]
      : [
          h("button", { type: "button", class: "ghost", onclick: () => openDialog(type, item.id) }, "Edit"),
          h("button", { type: "button", class: "ghost", onclick: () => { state.pendingDelete = token; render(); } }, "Delete"),
        ]),
  ]);
}

function housingEditor() {
  const cfg = state.snapshot.housingConfig || {};
  return h("section", { class: "card", style: "padding:16px;display:grid;gap:12px" }, [
    h("h2", {}, "Rent"),
    h("p", { class: "note" }, "The minimum is what this month must get. The rest waits until a check can cover it."),
    h("form", { id: "rent-form", class: "stack", onsubmit: saveRent }, [
      field("Monthly rent", h("input", { name: "currentMonthlyRent", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: cfg.currentMonthlyRent ?? "" })),
      field("Minimum to pay on the current month", h("input", { name: "minimumAcceptablePayment", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: cfg.minimumAcceptablePayment ?? "" })),
      field("Due day", h("input", { name: "rentDueDay", type: "number", min: "1", max: "31", step: "1", value: cfg.rentDueDay ?? 1 })),
      h("button", { type: "submit", class: "primary" }, "Save rent"),
    ]),
  ]);
}

function saveRent(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const currentMonthlyRent = numberOrZero(data.get("currentMonthlyRent"));
  const minimumAcceptablePayment = numberOrZero(data.get("minimumAcceptablePayment"));
  const rentDueDay = Math.min(31, Math.max(1, numberOrZero(data.get("rentDueDay")) || 1));
  commit({
    ...state.snapshot,
    housingConfig: {
      ...(state.snapshot.housingConfig || { id: "primary-housing" }),
      currentMonthlyRent,
      minimumAcceptablePayment,
      rentDueDay,
    },
  });
}

function resetRow() {
  const confirming = state.pendingDelete === "all";
  return h("div", { class: "row" }, confirming
    ? [
        h("span", {}, "Erase this plan from this browser?"),
        h("button", { type: "button", class: "danger", onclick: () => { state = freshState(); save(); render(); } }, "Erase"),
        h("button", { type: "button", class: "ghost", onclick: () => { state.pendingDelete = null; render(); } }, "Keep"),
      ]
    : [h("button", { type: "button", class: "danger", onclick: () => { state.pendingDelete = "all"; render(); } }, "Erase saved plan")]);
}

function hasObligations() {
  const snap = state.snapshot;
  return Boolean(snap.bills?.length || snap.expenses?.length || snap.debts?.length || snap.housingBuckets?.length || snap.housingConfig);
}

function emptyState() {
  return h("section", { class: "card", style: "padding:18px;display:grid;gap:12px" }, [
    h("div", { class: "row" }, [
      h("button", { type: "button", class: "primary big", onclick: () => openDialog("income") }, "Add income"),
      h("button", { type: "button", class: "ghost", onclick: loadSample }, "Load sample plan"),
      h("button", { type: "button", class: "ghost", onclick: () => { setView("edit"); document.getElementById("import-file")?.click(); } }, "Import backup"),
    ]),
    state.sampleError ? h("p", { class: "error" }, state.sampleError) : null,
  ]);
}

function waitingList(plan) {
  return h("section", { class: "stack" }, [
    h("h2", {}, "Waiting for a paycheck"),
    h("ul", { class: "actions" }, plan.waiting.map((item) => h("li", { class: "action" }, [
      h("b", {}, item.label),
      h("span", { class: "money" }, money(item.amount)),
      h("span", { class: "meta" }, formatDay(item.due || item.date)),
    ]))),
  ]);
}

function statusCard(plan, cycle) {
  let status = cycle?.status || plan.status;
  let label = cycle?.statusLabel || plan.statusLabel;
  let detail = cycle?.statusDetail || plan.statusDetail;
  if (cycle && cycle.requiredTotal === 0 && cycle.short === 0) {
    status = "needs_setup";
    label = "Nothing is due this stretch";
    detail = "Add a bill, rent, or an everyday cost. This check does not have anything it must cover yet.";
  }
  return h("section", { class: `status ${status}`, role: "status" }, [
    h("strong", {}, label),
    h("p", {}, detail),
  ]);
}

function dateBanner() {
  const fileDay = state.snapshot.today;
  const today = todayISO();
  if (!fileDay || fileDay === today) return null;
  const usingFile = planAsOf() === fileDay;
  return h("section", { class: "banner" }, [
    h("p", {}, usingFile
      ? `Showing the plan as of ${formatDay(fileDay)}, the date on this backup.`
      : `Planning from today. Unpaid items dated before ${formatDay(today)} still count.`),
    h("div", { class: "row" }, [
      usingFile
        ? h("button", { type: "button", class: "primary", onclick: () => { state.asOfChoice = "today"; state.month = monthFor(state.snapshot, "today"); state.cycleIndex = 0; save(); render(); } }, "Plan from today")
        : h("button", { type: "button", class: "ghost", onclick: () => { state.asOfChoice = "snapshot"; state.month = monthFor(state.snapshot, "snapshot"); state.cycleIndex = 0; save(); render(); } }, `Plan from ${formatDay(fileDay)}`),
      h("button", { type: "button", class: "ghost", onclick: () => commit(forgiveBefore(state.snapshot, today), { asOfChoice: "today", cycleIndex: 0 }) }, "Clear older unpaid items"),
    ]),
  ]);
}

function cyclePicker(plan) {
  return h("div", { class: "chips", role: "listbox", "aria-label": "Paychecks" }, plan.cycles.map((cycle, index) => h("button", {
    type: "button",
    role: "option",
    "aria-pressed": index === Math.min(state.cycleIndex, plan.cycles.length - 1) ? "true" : "false",
    onclick: () => { state.cycleIndex = index; render(); },
  }, [
    h("span", {}, [h("i", { class: `dot ${cycle.status}` }), formatDay(cycle.start)]),
    h("small", {}, `${money(cycle.paycheck.net)} · ${cycle.short > 0 ? `Short ${money(cycle.short)}` : cycle.requiredTotal === 0 ? "Nothing due" : cycle.status === "tight" ? "Tight" : "Covered"}`),
  ])));
}

function controls() {
  const settings = state.snapshot.settings || {};
  const scenario = settings.selectedScenarioMode || "MOST_EFFICIENT";
  const housing = settings.housingPaymentMode || "MINIMUM_CURRENT";
  return h("div", { class: "controls" }, [
    h("div", {}, [
      h("div", { class: "control-label" }, "Income to use"),
      h("div", { class: "segmented", role: "group", "aria-label": "Income to use" }, [
        ["LOWEST_INCOME", "Lowest"],
        ["MOST_EFFICIENT", "Expected"],
        ["HIGHEST_INCOME", "Highest"],
      ].map(([id, label]) => h("button", {
        type: "button",
        "aria-pressed": scenario === id ? "true" : "false",
        onclick: () => updateSettings({ selectedScenarioMode: id }),
      }, label))),
    ]),
    h("div", {}, [
      h("div", { class: "control-label" }, "Current rent"),
      h("div", { class: "segmented", role: "group", "aria-label": "Current rent" }, [
        ["MINIMUM_CURRENT", "Minimum"],
        ["FULL", "Full amount"],
      ].map(([id, label]) => h("button", {
        type: "button",
        "aria-pressed": housing === id ? "true" : "false",
        onclick: () => updateSettings({ housingPaymentMode: id }),
      }, label))),
    ]),
    h("label", { class: "cushion-field" }, [
      h("span", { class: "control-label" }, "Cushion to keep"),
      h("input", {
        type: "number",
        min: "0",
        step: "1",
        inputmode: "decimal",
        value: settings.targetBuffer ?? 0,
        "aria-label": "Cushion to keep",
        onchange: (event) => updateSettings({ targetBuffer: Math.max(0, Number(event.target.value) || 0) }),
      }),
    ]),
  ]);
}

function updateSettings(patch) {
  commit({
    ...state.snapshot,
    settings: { ...(state.snapshot.settings || {}), ...patch },
  });
}

function tiles(plan, cycle) {
  const short = cycle.short > 0;
  return h("div", { class: "tiles" }, [
    tile("This check", money(cycle.paycheck.net), ""),
    tile("Must pay", money(cycle.requiredTotal), ""),
    tile("Covered", money(cycle.covered), short ? "" : "good"),
    short
      ? tile("Short", money(cycle.short), "bad")
      : tile("Cushion", money(cycle.cushion), cycle.status === "tight" ? "warn" : "good"),
  ]);
}

function tile(label, value, tone) {
  return h("div", { class: `tile ${tone}` }, [h("span", {}, label), h("strong", {}, value)]);
}

function cycleNote(plan, cycle) {
  const bits = [];
  if (cycle.index === 0 && plan.startingCash > 0) {
    bits.push(`Covered money includes ${money(plan.startingCash)} already in planning accounts.`);
  }
  const delayed = cycle.lines.filter((line) => line.state === "delay");
  if (delayed.length && cycle.short === 0) {
    bits.push(`${delayed.length} non-essential ${delayed.length === 1 ? "item is" : "items are"} waiting so the cushion stays intact.`);
  }
  const next = plan.cycles[cycle.index + 1];
  if (next?.short > 0) bits.push(`Keep the leftover. The ${formatDay(next.start)} check is still short ${money(next.short)}.`);
  if (!bits.length && cycle.balanceAfter > cycle.cushion) {
    bits.push(`${money(roundSafe(cycle.balanceAfter - cycle.cushion))} is still in the account after this stretch and is not assigned.`);
  }
  return bits.join(" ");
}

function roundSafe(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function actionList(cycle) {
  return h("ol", { class: "actions" }, cycle.lines.map((line) => h("li", { class: "action" }, [
    h("div", {}, [
      h("b", {}, line.state === "deposit" ? `Deposit ${line.label}` : line.label),
      line.detail ? h("div", { class: "meta" }, line.detail) : null,
    ]),
    h("div", {}, [
      h("div", { class: "money" }, line.state === "partial" ? `${money(line.paid)} of ${money(line.amount)}` : money(line.amount)),
      h("div", { class: `tag ${line.state}` }, stateWord(line)),
    ]),
    line.state === "deposit" ? null : h("div", { class: "buttons" }, [
      h("button", { type: "button", class: "ghost", onclick: () => commit(markPaid(state.snapshot, line.key, planAsOf())) }, "I paid this"),
      editTarget(line) ? h("button", { type: "button", class: "ghost", onclick: () => { const target = editTarget(line); openDialog(target.type, target.id); } }, "Edit") : null,
    ]),
  ])));
}

function undoControl() {
  if (!state.snapshot.payments?.length) return null;
  return h("button", {
    type: "button",
    class: "ghost",
    onclick: () => commit({ ...state.snapshot, payments: state.snapshot.payments.slice(0, -1) }),
  }, "Undo last payment");
}

function stateWord(line) {
  if (line.state === "deposit") return "In";
  if (line.state === "pay") return "Pay";
  if (line.state === "partial") return "Part";
  if (line.state === "delay") return "Later";
  return "Doesn't fit";
}

function editTarget(line) {
  const ref = line.ref || {};
  if (ref.type === "expense") return { type: "expense", id: ref.id };
  if (ref.type === "bill") return { type: "bill", id: ref.id };
  if (ref.type === "installment") return { type: "debt", id: ref.debtId };
  if (ref.type === "debt") return { type: "debt", id: ref.id };
  if (ref.type === "housing") return { type: "housing", id: ref.id };
  if (ref.type === "income") return { type: "income", id: ref.id };
  return null;
}

function suggestionList(plan) {
  return h("section", { class: "stack" }, [
    h("h2", {}, "What to change"),
    ...plan.suggestions.map((item) => h("article", { class: "suggestion" }, [
      h("strong", {}, item.title),
      h("p", {}, item.detail),
    ])),
  ]);
}

function debtBlock(plan) {
  return h("section", { class: "stack" }, [
    h("h2", {}, "Debt still on the books"),
    h("ul", { class: "actions" }, plan.debts.map((debt) => h("li", { class: "action" }, [
      h("b", {}, debt.name),
      h("span", { class: "money" }, money(debt.balance)),
      h("span", { class: "meta" }, `${money(debt.scheduled)} is scheduled in the dated payments. ${money(Math.max(0, debt.leftAfterScheduled))} would remain after those.`),
    ]))),
  ]);
}

function draftFor(type, id) {
  const snap = state.snapshot;
  const found = (list) => (list || []).find((item) => item.id === id);
  if (type === "account") {
    const item = found(snap.accounts) || {};
    return { name: item.name || "", accountType: item.type || "Checking", availableBalance: item.availableBalance ?? "", include: item.includeInPlanning !== false, notes: item.notes || "" };
  }
  if (type === "income") {
    const item = found(snap.incomeSources) || {};
    const rule = item.recurringRule || {};
    const varies = item.forecastAmountMode === "RANGE";
    return {
      name: item.name || "",
      payerLabel: item.payerLabel || "",
      frequency: rule.type || "WEEKLY",
      anchorDate: rule.anchorDate || item.nextExpectedPayDate || planAsOf(),
      dayOfMonth: rule.dayOfMonth || "",
      intervalDays: rule.intervalDays || 28,
      semiA: rule.semiMonthlyDays?.[0] || 1,
      semiB: rule.semiMonthlyDays?.[1] || 15,
      varies,
      amount: item.amountRange?.target ?? "",
      minimum: item.amountRange?.minimum ?? "",
      maximum: item.amountRange?.maximum ?? "",
      inputMode: item.inputMode || "NET",
      notes: item.notes || "",
    };
  }
  if (type === "bill" || type === "expense") {
    const item = found(type === "bill" ? snap.bills : snap.expenses) || {};
    const rule = item.recurringRule || {};
    return {
      name: item.name || "",
      amount: type === "bill" ? (item.amountDue ?? "") : (item.amount ?? ""),
      category: item.category || item.categoryLabel || "",
      frequency: rule.type || "MONTHLY",
      anchorDate: rule.anchorDate || planAsOf(),
      dayOfMonth: rule.dayOfMonth || "",
      intervalDays: rule.intervalDays || 28,
      semiA: rule.semiMonthlyDays?.[0] || 1,
      semiB: rule.semiMonthlyDays?.[1] || 15,
      essential: type === "expense" ? item.isEssential !== false : item.isEssential === true,
      notes: item.notes || "",
    };
  }
  if (type === "debt") {
    const item = found(snap.debts) || {};
    return {
      name: item.name || "",
      lender: item.lender || "",
      currentBalance: item.currentBalance ?? "",
      reborrowAllowed: item.reborrowAllowed === true,
      maxSafeReborrowAmount: item.maxSafeReborrowAmount ?? "",
      installments: (item.installments || []).map((inst) => ({ ...inst })),
      notes: item.notes || "",
    };
  }
  if (type === "housing") {
    const item = found(snap.housingBuckets) || {};
    return {
      label: item.label || "",
      monthKey: item.monthKey || planAsOf().slice(0, 7),
      amountDue: item.amountDue ?? "",
      amountPaid: item.amountPaid ?? 0,
      dueDate: item.dueDate || planAsOf(),
      isCurrentBucket: item.isCurrentBucket === true,
      notes: item.notes || "",
    };
  }
  const item = found(snap.deductionRules) || {};
  return {
    name: item.name || "",
    incomeSourceId: item.incomeSourceId || "",
    valueType: item.valueType || "PERCENTAGE",
    percentage: item.percentage != null ? Math.round(item.percentage * 1000) / 10 : "",
    fixedAmount: item.fixedAmount ?? "",
    notes: item.notes || "",
  };
}

function renderDialog() {
  const root = document.getElementById("dialog-root");
  if (!state.dialog) {
    root.replaceChildren();
    return;
  }
  const { type, error, draft } = state.dialog;
  const activeName = document.activeElement?.getAttribute?.("name");
  const form = h("form", { class: "dialog", id: "editor", autocomplete: "off", onsubmit: saveDialog }, [
    h("h2", {}, `${state.dialog.id ? "Edit" : "Add"} ${dialogTitle(type)}`),
    error ? h("p", { class: "error", role: "alert" }, error) : null,
    ...dialogFields(type, draft),
    h("div", { class: "row" }, [
      h("button", { type: "submit", class: "primary" }, "Save"),
      h("button", { type: "button", class: "ghost", onclick: closeDialog }, "Cancel"),
    ]),
  ]);
  const backdrop = h("div", { class: "backdrop", onclick: (event) => { if (event.target === backdrop) closeDialog(); } }, [form]);
  root.replaceChildren(backdrop);
  const nextFocus = activeName ? form.querySelector(`[name="${CSS.escape(activeName)}"]`) : null;
  (nextFocus || form.querySelector("input, select, textarea"))?.focus();
}

function dialogTitle(type) {
  return { account: "account", income: "income", bill: "bill", expense: "everyday cost", debt: "debt", housing: "housing bucket", deduction: "deduction" }[type] || "item";
}

function dialogFields(type, draft) {
  if (type === "account") {
    return [
      field("Name", h("input", { name: "name", required: true, value: draft.name })),
      field("Type", select("accountType", draft.accountType, [["Checking", "Checking"], ["Savings", "Savings"], ["Cash", "Cash"], ["Other", "Other"]])),
      field("Available", h("input", { name: "availableBalance", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: draft.availableBalance })),
      check("include", "Include this money in the plan", draft.include),
    ];
  }
  if (type === "income") {
    return [
      field("Name", h("input", { name: "name", required: true, value: draft.name, placeholder: "Weekly pay" })),
      field("Who pays it", h("input", { name: "payerLabel", value: draft.payerLabel })),
      ...scheduleFields(draft),
      check("varies", "The amount changes from check to check", draft.varies, () => mutateDraft(() => {})),
      draft.varies
        ? field("Low", h("input", { name: "minimum", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: draft.minimum }))
        : null,
      field(draft.varies ? "Typical" : "Amount", h("input", { name: "amount", type: "number", min: "0", step: "0.01", inputmode: "decimal", required: true, value: draft.amount })),
      draft.varies
        ? field("High", h("input", { name: "maximum", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: draft.maximum }))
        : null,
      field("This amount is", select("inputMode", draft.inputMode, [["NET", "Take-home"], ["GROSS", "Before deductions"]])),
      field("Note", h("input", { name: "notes", value: draft.notes })),
    ];
  }
  if (type === "bill" || type === "expense") {
    return [
      field("Name", h("input", { name: "name", required: true, value: draft.name })),
      field("Amount", h("input", { name: "amount", type: "number", min: "0", step: "0.01", inputmode: "decimal", required: true, value: draft.amount })),
      field("Category", h("input", { name: "category", value: draft.category })),
      ...scheduleFields(draft),
      check("essential", type === "expense" ? "Pay this before rent and other bills" : "This bill has to be paid before extras", draft.essential),
      field("Note", h("input", { name: "notes", value: draft.notes })),
    ];
  }
  if (type === "debt") {
    return [
      field("Name", h("input", { name: "name", required: true, value: draft.name })),
      field("Lender", h("input", { name: "lender", value: draft.lender })),
      field("Balance", h("input", { name: "currentBalance", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: draft.currentBalance })),
      check("reborrowAllowed", "Borrowing again is even possible", draft.reborrowAllowed),
      field("Most that would ever be safe to re-borrow", h("input", { name: "maxSafeReborrowAmount", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: draft.maxSafeReborrowAmount })),
      h("span", { class: "field-label" }, "Dated payments"),
      ...(draft.installments || []).map((inst, index) => h("div", { class: "inst-row" }, [
        h("input", { type: "date", name: `inst-date-${index}`, value: inst.dueDate || "", "aria-label": "Payment date" }),
        h("input", { type: "number", name: `inst-amount-${index}`, min: "0", step: "0.01", inputmode: "decimal", value: inst.amount ?? "", "aria-label": "Payment amount" }),
        h("input", { type: "text", name: `inst-label-${index}`, value: inst.label || "", placeholder: "Label", "aria-label": "Payment label" }),
        h("button", { type: "button", class: "ghost", onclick: () => mutateDraft((next) => next.installments.splice(index, 1)) }, "Remove"),
      ])),
      h("button", { type: "button", class: "ghost", onclick: () => mutateDraft((next) => next.installments.push({ dueDate: planAsOf(), amount: "", label: "" })) }, "Add payment"),
      field("Note", h("input", { name: "notes", value: draft.notes })),
    ];
  }
  if (type === "housing") {
    return [
      field("Label", h("input", { name: "label", required: true, value: draft.label, placeholder: "April rent" })),
      field("Month", h("input", { name: "monthKey", type: "month", value: draft.monthKey })),
      field("Amount due", h("input", { name: "amountDue", type: "number", min: "0", step: "0.01", inputmode: "decimal", required: true, value: draft.amountDue })),
      field("Already paid", h("input", { name: "amountPaid", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: draft.amountPaid })),
      field("Due date", h("input", { name: "dueDate", type: "date", required: true, value: draft.dueDate })),
      check("isCurrentBucket", "This is the current month, not back rent", draft.isCurrentBucket),
      field("Note", h("input", { name: "notes", value: draft.notes })),
    ];
  }
  const incomes = (state.snapshot.incomeSources || []).map((item) => [item.id, item.name || "Income"]);
  return [
    field("Name", h("input", { name: "name", required: true, value: draft.name, placeholder: "Tithe" })),
    field("Applies to", select("incomeSourceId", draft.incomeSourceId, [["", "Every paycheck"], ...incomes])),
    field("Kind", select("valueType", draft.valueType, [["PERCENTAGE", "Percent"], ["FIXED", "Fixed amount"]], () => mutateDraft(() => {}))),
    draft.valueType === "FIXED"
      ? field("Amount", h("input", { name: "fixedAmount", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: draft.fixedAmount }))
      : field("Percent", h("input", { name: "percentage", type: "number", min: "0", max: "100", step: "0.1", inputmode: "decimal", value: draft.percentage })),
    field("Note", h("input", { name: "notes", value: draft.notes })),
  ];
}

function scheduleFields(draft) {
  return [
    field("How often", select("frequency", draft.frequency, FREQUENCIES, () => mutateDraft(() => {}))),
    field(draft.frequency === "ONE_TIME" ? "Date" : "Next date", h("input", { name: "anchorDate", type: "date", required: true, value: draft.anchorDate })),
    draft.frequency === "MONTHLY"
      ? field("Day of the month", h("input", { name: "dayOfMonth", type: "number", min: "1", max: "31", step: "1", value: draft.dayOfMonth || (draft.anchorDate || "").slice(8) }))
      : null,
    draft.frequency === "EVERY_X_DAYS"
      ? field("Days between", h("input", { name: "intervalDays", type: "number", min: "1", step: "1", value: draft.intervalDays }))
      : null,
    draft.frequency === "SEMI_MONTHLY"
      ? field("First day", h("input", { name: "semiA", type: "number", min: "1", max: "31", value: draft.semiA }))
      : null,
    draft.frequency === "SEMI_MONTHLY"
      ? field("Second day", h("input", { name: "semiB", type: "number", min: "1", max: "31", value: draft.semiB }))
      : null,
  ];
}

function field(label, control) {
  if (!control) return null;
  return h("label", { class: "field" }, [h("span", {}, label), control]);
}

function check(name, label, checked, onchange) {
  return h("label", { class: "check" }, [
    h("input", { type: "checkbox", name, checked, onchange }),
    label,
  ]);
}

function select(name, value, options, onchange) {
  return h("select", { name, value, onchange }, options.map(([optionValue, label]) => h("option", { value: optionValue }, label)));
}

function captureDraft() {
  const form = document.getElementById("editor");
  if (!form || !state.dialog) return;
  const data = new FormData(form);
  const previous = state.dialog.draft;
  const type = state.dialog.type;
  const base = {
    ...previous,
    name: data.get("name") ?? previous.name,
    notes: data.get("notes") ?? previous.notes,
  };
  if (type === "account") {
    Object.assign(base, {
      accountType: data.get("accountType"),
      availableBalance: data.get("availableBalance"),
      include: data.get("include") === "on",
    });
  } else if (type === "income" || type === "bill" || type === "expense") {
    Object.assign(base, scheduleDraft(data, previous), {
      amount: data.get("amount"),
      category: data.get("category") ?? previous.category,
      payerLabel: data.get("payerLabel") ?? previous.payerLabel,
      varies: data.get("varies") === "on",
      minimum: data.get("minimum") ?? previous.minimum,
      maximum: data.get("maximum") ?? previous.maximum,
      inputMode: data.get("inputMode") || previous.inputMode,
      essential: data.get("essential") === "on",
    });
  } else if (type === "debt") {
    Object.assign(base, {
      lender: data.get("lender"),
      currentBalance: data.get("currentBalance"),
      reborrowAllowed: data.get("reborrowAllowed") === "on",
      maxSafeReborrowAmount: data.get("maxSafeReborrowAmount"),
      installments: (previous.installments || []).map((inst, index) => ({
        ...inst,
        dueDate: data.get(`inst-date-${index}`) || "",
        amount: data.get(`inst-amount-${index}`) ?? "",
        label: data.get(`inst-label-${index}`) || "",
      })),
    });
  } else if (type === "housing") {
    Object.assign(base, {
      label: data.get("label"),
      monthKey: data.get("monthKey"),
      amountDue: data.get("amountDue"),
      amountPaid: data.get("amountPaid"),
      dueDate: data.get("dueDate"),
      isCurrentBucket: data.get("isCurrentBucket") === "on",
    });
  } else {
    Object.assign(base, {
      incomeSourceId: data.get("incomeSourceId"),
      valueType: data.get("valueType"),
      percentage: data.get("percentage"),
      fixedAmount: data.get("fixedAmount"),
    });
  }
  state.dialog.draft = base;
}

function scheduleDraft(data, previous) {
  return {
    frequency: data.get("frequency") || previous.frequency,
    anchorDate: data.get("anchorDate") || previous.anchorDate,
    dayOfMonth: data.get("dayOfMonth") || previous.dayOfMonth,
    intervalDays: data.get("intervalDays") || previous.intervalDays,
    semiA: data.get("semiA") || previous.semiA,
    semiB: data.get("semiB") || previous.semiB,
  };
}

function mutateDraft(change) {
  captureDraft();
  change(state.dialog.draft);
  render();
}

function saveDialog(event) {
  event.preventDefault();
  captureDraft();
  const { type, id, draft } = state.dialog;
  const error = validate(type, draft);
  if (error) {
    state.dialog.error = error;
    render();
    return;
  }
  const snapshot = structuredClone(state.snapshot);
  upsert(snapshot, type, id, draft);
  state.dialog = null;
  state.view = type === "income" && !(state.snapshot.incomeSources || []).length ? "home" : state.view;
  state.cycleIndex = 0;
  commit(snapshot);
}

function validate(type, draft) {
  const name = (draft.name || draft.label || "").trim();
  if (!name) return "Give this a name.";
  if (type === "income" || type === "bill" || type === "expense") {
    if (!draft.anchorDate) return "Pick a date.";
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero.";
    if (type === "income" && draft.varies) {
      const low = Number(draft.minimum);
      const high = Number(draft.maximum);
      if (!(low <= amount && amount <= high)) return "Put the amounts in order: low, typical, then high.";
    }
  }
  if (type === "housing") {
    if (!draft.dueDate) return "Pick a due date.";
    if (!(Number(draft.amountDue) > 0)) return "Enter the amount still due.";
  }
  if (type === "deduction") {
    if (draft.valueType === "FIXED" && !(Number(draft.fixedAmount) > 0)) return "Enter the amount withheld.";
    if (draft.valueType !== "FIXED" && !(Number(draft.percentage) > 0)) return "Enter the percent withheld.";
  }
  if (type === "debt") {
    for (const inst of draft.installments || []) {
      const hasAny = inst.dueDate || inst.amount || inst.label;
      if (hasAny && (!inst.dueDate || !(Number(inst.amount) > 0))) return "Each payment needs a date and an amount.";
    }
  }
  return "";
}

function upsert(snapshot, type, id, draft) {
  const lists = {
    account: "accounts",
    income: "incomeSources",
    bill: "bills",
    expense: "expenses",
    debt: "debts",
    housing: "housingBuckets",
    deduction: "deductionRules",
  };
  const key = lists[type];
  const list = snapshot[key] || [];
  const existing = list.find((item) => item.id === id);
  const record = buildRecord(type, draft, existing);
  snapshot[key] = existing ? list.map((item) => item.id === id ? record : item) : [...list, record];
}

function buildRecord(type, draft, existing) {
  const id = existing?.id || newId(type);
  if (type === "account") {
    const available = numberOrZero(draft.availableBalance);
    return { ...(existing || {}), id, name: draft.name.trim(), type: draft.accountType || "Checking", currentBalance: available, availableBalance: available, includeInPlanning: draft.include !== false, notes: draft.notes || "", customFields: existing?.customFields || [] };
  }
  if (type === "income") {
    const typical = numberOrZero(draft.amount);
    const range = draft.varies
      ? { minimum: numberOrZero(draft.minimum), target: typical, maximum: numberOrZero(draft.maximum) }
      : { minimum: typical, target: typical, maximum: typical };
    return {
      ...(existing || {}),
      id,
      name: draft.name.trim(),
      payerLabel: draft.payerLabel || "",
      recurringRule: ruleFrom(draft),
      amountRange: range,
      forecastAmountMode: draft.varies ? "RANGE" : "FIXED",
      inputMode: draft.inputMode || "NET",
      nextExpectedPayDate: draft.anchorDate,
      isActive: true,
      isManualOnly: false,
      notes: draft.notes || "",
      deductionRuleIds: existing?.deductionRuleIds || [],
      customFields: existing?.customFields || [],
    };
  }
  if (type === "bill") {
    const amount = numberOrZero(draft.amount);
    return {
      ...(existing || {}),
      id,
      name: draft.name.trim(),
      amountDue: amount,
      currentAmountDue: amount,
      minimumDue: amount,
      recurringRule: ruleFrom(draft),
      category: draft.category || "",
      isEssential: draft.essential === true,
      status: existing?.status || "UPCOMING",
      notes: draft.notes || "",
      customFields: existing?.customFields || [],
    };
  }
  if (type === "expense") {
    return {
      ...(existing || {}),
      id,
      name: draft.name.trim(),
      amount: numberOrZero(draft.amount),
      categoryLabel: draft.category || "",
      recurringRule: ruleFrom(draft),
      isEssential: draft.essential === true,
      notes: draft.notes || "",
      customFields: existing?.customFields || [],
    };
  }
  if (type === "debt") {
    const installments = (draft.installments || []).filter((inst) => inst.dueDate && Number(inst.amount) > 0).map((inst) => ({
      id: inst.id || newId("pay"),
      dueDate: inst.dueDate,
      amount: numberOrZero(inst.amount),
      label: inst.label || "",
    }));
    return {
      ...(existing || {}),
      id,
      name: draft.name.trim(),
      lender: draft.lender || "",
      type: existing?.type || "REVOLVING_CREDIT",
      currentBalance: numberOrZero(draft.currentBalance),
      reborrowAllowed: draft.reborrowAllowed === true,
      maxSafeReborrowAmount: numberOrZero(draft.maxSafeReborrowAmount),
      installments,
      minimumDue: installments[0]?.amount || existing?.minimumDue || 0,
      requiredDueDate: installments[0]?.dueDate || existing?.requiredDueDate || null,
      notes: draft.notes || "",
      customFields: existing?.customFields || [],
    };
  }
  if (type === "housing") {
    return {
      ...(existing || {}),
      id,
      label: draft.label.trim(),
      monthKey: draft.monthKey,
      amountDue: numberOrZero(draft.amountDue),
      amountPaid: numberOrZero(draft.amountPaid),
      dueDate: draft.dueDate,
      isCurrentBucket: draft.isCurrentBucket === true,
      notes: draft.notes || "",
    };
  }
  const scope = draft.incomeSourceId ? "INCOME_SOURCE" : "ALL";
  return {
    ...(existing || {}),
    id,
    name: draft.name.trim(),
    scope,
    incomeSourceId: draft.incomeSourceId || null,
    valueType: draft.valueType === "FIXED" ? "FIXED" : "PERCENTAGE",
    percentage: draft.valueType === "FIXED" ? 0 : numberOrZero(draft.percentage) / 100,
    fixedAmount: draft.valueType === "FIXED" ? numberOrZero(draft.fixedAmount) : 0,
    isEnabledByDefault: true,
    notes: draft.notes || "",
    customFields: existing?.customFields || [],
  };
}

function ruleFrom(draft) {
  const type = draft.frequency || "MONTHLY";
  const rule = { type, anchorDate: draft.anchorDate };
  if (type === "MONTHLY") {
    rule.dayOfMonth = Number(draft.dayOfMonth) || Number(String(draft.anchorDate).slice(8)) || 1;
  }
  if (type === "EVERY_X_DAYS") rule.intervalDays = Math.max(1, Number(draft.intervalDays) || 1);
  if (type === "SEMI_MONTHLY") {
    rule.semiMonthlyDays = [Number(draft.semiA) || 1, Number(draft.semiB) || 15].sort((a, b) => a - b);
  }
  if (type === "WEEKLY" || type === "BIWEEKLY") rule.dayOfWeek = parseDate(draft.anchorDate).getUTCDay();
  return rule;
}

function removeRecord(type, id) {
  const lists = { account: "accounts", income: "incomeSources", bill: "bills", expense: "expenses", debt: "debts", housing: "housingBuckets", deduction: "deductionRules" };
  const key = lists[type];
  state.pendingDelete = null;
  commit({ ...state.snapshot, [key]: (state.snapshot[key] || []).filter((item) => item.id !== id) });
}

function monthFor(snapshot, choice) {
  const asOf = choice === "snapshot" && snapshot.today ? snapshot.today : todayISO();
  try {
    const plan = buildPlan(snapshot, { asOf });
    return (plan.cycles[0]?.start || plan.calendar[0]?.date || asOf).slice(0, 7);
  } catch {
    return asOf.slice(0, 7);
  }
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function incomeSummary(item) {
  const range = item.amountRange || {};
  const amount = item.forecastAmountMode === "RANGE"
    ? `${money(range.minimum)}–${money(range.maximum)}, typical ${money(range.target)}`
    : money(range.target ?? range.minimum ?? 0);
  return `${amount} · ${frequencyLabel(item.recurringRule)} · ${item.inputMode === "GROSS" ? "before deductions" : "take-home"}`;
}

function frequencyLabel(rule) {
  return FREQUENCIES.find(([id]) => id === rule?.type)?.[1] || "Scheduled";
}

function deductionSummary(item) {
  const amount = item.valueType === "PERCENTAGE" ? `${Math.round((item.percentage || 0) * 1000) / 10}%` : money(item.fixedAmount || 0);
  const who = (state.snapshot.incomeSources || []).find((source) => source.id === item.incomeSourceId);
  return `${amount} of ${who?.name || "every paycheck"}`;
}

async function loadSample() {
  state.sampleError = "";
  try {
    let response = await fetch("./sample-backup.json");
    if (!response.ok) response = await fetch("../billpayer-full-financial-dataset-backup.json");
    if (!response.ok) throw new Error("missing");
    const data = await response.json();
    const snapshot = data.snapshot || data;
    if (!Array.isArray(snapshot.incomeSources)) throw new Error("shape");
    state.dialog = null;
    state.sampleError = "";
    const choice = snapshot.today ? "snapshot" : "today";
    state.month = monthFor(snapshot, choice);
    commit(snapshot, { asOfChoice: choice, view: "home", cycleIndex: 0 });
  } catch {
    state.sampleError = "Couldn't load the sample plan. Use Import and choose the backup file instead.";
    render();
  }
}

function exportBackup() {
  const payload = { schemaVersion: 1, appVersion: "1.0", exportedAt: new Date().toISOString(), snapshot: state.snapshot };
  const file = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = "billpayer-backup.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const snapshot = data.snapshot || data;
    if (!snapshot || typeof snapshot !== "object" || (!snapshot.incomeSources && !snapshot.bills && !snapshot.accounts)) {
      throw new Error("shape");
    }
    const choice = snapshot.today ? "snapshot" : "today";
    const merged = { ...blankSnapshot(snapshot.today || todayISO()), ...snapshot };
    state.month = monthFor(merged, choice);
    commit(merged, { asOfChoice: choice, view: "home", cycleIndex: 0 });
  } catch {
    state.sampleError = "That file isn't a BillPayer backup.";
    render();
  }
}

render();
