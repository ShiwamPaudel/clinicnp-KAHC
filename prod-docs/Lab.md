# Lab.md — the Laboratory module

The in-house laboratory, built for Koshi Aarogya Healthcare (owner's scope,
2083-08-03). It is the third module beside Pharmacy and Clinic: switched on per
install (`company.module_lab`, 0023), enforced on the server with
`requireModule('lab')`, hidden — never deleted — when switched off.

The flow is the one the owner asked for: **a bill with lab tests goes to
Sample Collection, then Result Entry, Approval, Reports and Dispatch**. The
pages are a ClinicNP-style port of an earlier laboratory product's tabs; that
product's name appears nowhere in ClinicNP (owner's instruction).

## Owner's decisions (2083-08-03)

| | Decision |
|---|---|
| Report delivery | **A QR code on the bill**, printed only when the bill carries a lab test. No SMS, no email. |
| The link | **Short** (`/r/<10 characters>`), opens the report **directly** — no phone check. Unguessable, and every view is logged. |
| Dues | The QR link shows nothing until the bill is **fully paid**. Staff can still print inside ClinicNP. |
| Referring doctor | **Typed name only** on the order and the report. No commission. |
| Reference ranges | Entered by KAHC's **lab in-charge**. Never seeded, guessed or copied in (Rules §2.2). |
| Sent-out tests | The existing send-out workflow stays as it is until the owner's official answer on in-house vs outside. |

## How a bill becomes a lab order

1. Lab tests and profiles are set up under **Lab → Tests / Profiles**. Each one
   owns a row in `services` (`lab_tests.service_id`, `lab_test_groups.service_id`),
   so the counter bills it exactly like any other service. Its price lives on
   the service; the lab catalogue never stores money.
2. At the counter a bill with a lab service carries a **report token** minted
   by the counter (`labReportToken`, 10 characters from an unambiguous
   alphabet), so the QR prints immediately, even offline.
3. `ingestBill` (same transaction, idempotent on the bill id) opens one
   `lab_orders` row for the bill, expands profiles into `lab_order_tests`, opens
   one `lab_samples` row per sample type, and one pending `lab_results` row per
   test. The counter's token is kept if well-formed and unused; otherwise the
   server mints one and the reprint shows it.
4. Cancelling the bill cancels the order. A sale return of a lab line cancels
   its tests.

## Workflow states

```
sample   waiting -> collected | rejected | recollection (-> waiting)
result   pending -> draft -> submitted -> approved -> dispatched
                         \-> correction_required (sent back / reopened)
order    sample_pending -> in_progress -> result_pending -> awaiting_approval
         -> approved -> dispatched   (or cancelled)
```

Reference ranges and flags are **snapshotted onto each value** when it is
entered, so a report always shows the range in force when it was validated.
Every submit and every change after approval writes a `lab_result_versions`
snapshot; approve / send back writes `lab_result_approvals`.

## Pages and permissions

| Page | Route | Permission |
|---|---|---|
| Sample collection, labels | `/lab/samples`, `/print/lab-label/[id]` | `lab.samples` |
| Result entry | `/lab/results`, `/lab/results/[orderId]` | `lab.results` |
| Approval | `/lab/approval`, `/lab/approval/[orderId]` | `lab.approve` |
| Reports (print) | `/lab/reports`, `/print/lab-report/[orderId]` | `lab.reports` |
| Dispatch | `/lab/dispatch` | `lab.dispatch` |
| Order detail | `/lab/orders/[orderId]` | any lab permission; reopen needs `lab.reopen` |
| Tests, profiles | `/lab/tests`, `/lab/profiles` | `lab.catalog` |
| Departments, sample types, report letterhead, signatures | Settings → Laboratory | `lab.catalog` |
| Patient's report | `/r/[token]` | public, rate-limited |

The existing send-out pages move from `/lab/*` to `/sendout/*` (`lab.sendout`,
Clinic module).

## Libraries added (Rules §3)

- `qrcode` — the QR on the bill and the report. Loaded only when printing.
- `bwip-js` — Code 128 barcodes on sample labels and reports.
- `pagedjs` — paginates the printed report so the letterhead, signatures and
  "Page X of Y" repeat on every page.
