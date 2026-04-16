# BillPayer

BillPayer is a Kotlin + Jetpack Compose Android app for paycheck-to-paycheck debt payoff, bill planning, cash-flow routing, arrears catch-up, and controlled decision support around revolving credit.

This project is built as a real planning app, not a toy bill tracker. It now runs on user-entered data only. There is no demo mode in the active app flow.

## Stack

- Kotlin
- Jetpack Compose + Material 3
- MVVM
- Navigation Compose
- Room
- DataStore
- Coroutines + StateFlow
- WorkManager
- Unit tests
- Clean-ish package split: `ui`, `domain`, `data`

## What The App Does

- Tracks unlimited accounts, income sources, paychecks, paycheck deductions, recurring expenses, bills, debts, and housing arrears buckets
- Rebuilds a paycheck-to-paycheck plan whenever the user changes financial inputs
- Forecasts income, bills, debt dues, and rent/current-vs-arrears housing obligations against real calendar dates
- Prioritizes essentials, hard dues, required debt dues, current housing, arrears, extra payoff, and cushion
- Evaluates controlled re-borrow safety for revolving debt products
- Learns paycheck ranges from the last 12 months of paycheck history
- Automatically deletes paycheck learning records older than 12 months
- Latches a green `OUT OF DEBT` screen only when debts are zero, arrears are zero, and all due-today obligations are current

## App Structure

- `Home` is the read-only projection screen. It shows calculated outputs, current priorities, due-before-next-paycheck items, catch-up analytics, and live recalculation timestamps.
- `Home` also allows limited input for the current cycle: actual paycheck entry and quick essential expense amount adjustments.
- `Edit` is the full-control maintenance area. This is where users manage accounts, income, bills, recurring expenses, debts, housing buckets, categories, labels, deductions, notifications, and backups.
- Calculated result fields stay read-only. Users do not edit allocations, projections, debt-free dates, warnings, or scenario results directly.

## Project Layout

```text
app/src/main/java/com/a_insiders/billpayer/
  data/
    local/        Room entities, DAO, DB, converters
    backup/       JSON backup import/export helpers
    repository/   Snapshot repository and mapping
    settings/     DataStore-backed app settings
  domain/
    engine/       Forecasting, allocation, debt-free, re-borrow, learning logic
    model/        Core financial models and plan DTOs
  ui/
    BillPayerApp.kt       Home, Edit, and onboarding Compose screens
    BillPayerViewModel.kt App state orchestration
  work/
    PlanRefreshWorker.kt  Background refresh and debt-free latch sync
```

## Real Data Only

- The app no longer starts from canned scenario data.
- All visible calculations are based on user-provided accounts, income, bills, recurring expenses, debts, housing buckets, and paycheck history.
- Blank onboarding is the default starting path.

## Income Learning And Scenario Modes

- If an income source is set to `FIXED`, the app shows a single forecast path.
- If an income source is set to `RANGE`, the planner can show:
  - `LOWEST_INCOME`
  - `MOST_EFFICIENT`
  - `HIGHEST_INCOME`
- Forecasts also learn from the most recent 12 months of paycheck history for that income source.
- Older paycheck history is purged automatically so predictions stay relevant and storage stays bounded.

## Deductions And Essentials

- Tithing is no longer hardcoded. It is modeled as a generic paycheck deduction rule.
- Deduction rules support fixed amounts or percentages, and can be global or income-source specific.
- Recurring expenses are fully user-defined and can be marked essential or non-essential, fixed or variable.
- Home shows essential expense amounts for the current pay period and allows quick updates there.

## Notifications

- Only payday reminders and “recalculate now” planning reminders are supported.
- Notification timing is user-configurable.
- Normal app storage stays internal.
- The app does not require storage permission for normal data use.

## Running

From the repo root:

```powershell
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug
```

To build/install from Android Studio, open the project normally and run the `app` configuration.

## Editing Rules In The UI

To keep the UI flexible without building a separate rule designer for every entity, several editors use text-based power fields:

- Recurring rule: `TYPE|anchorDate|intervalDays|dayOfMonth|semiMonthlyDays`
- Custom fields: one `label=value` pair per line
- Debt installments: one `yyyy-mm-dd|amount|label` per line

Examples:

```text
MONTHLY|2026-04-05||5|
EVERY_X_DAYS|2026-04-07|28||
```

```text
Case manager=Call before paying late fee
Landlord note=Apply partial payment to April current rent first
```

```text
2026-04-17|126|Apr 17 due
2026-04-24|284|Apr 24 due
2026-05-01|168|May 1 due
```

## Tests

`PlannerEngineTest` covers:

- blank mode with no sample data
- no hardcoded cigarette requirement
- generic deductions disabled
- user-created tithing and savings deductions
- custom bill and debt names
- bill date shifts changing due-now output
- rolling 12-month paycheck learning
- fixed vs range scenario behavior

## Notes

- The planning engine is intentionally generic and data-driven, but still conservative where current obligations and arrears are involved.
- The debt summary card reports current balances left, while the timeline shows the forward-looking plan.
- Home is output-first; Edit is where full maintenance happens.
