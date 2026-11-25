# Lab.md — the Laboratory module

The in-house laboratory, built for Koshi Aarogya Healthcare (owner's scope,
2083-08-03). It is the third module beside Pharmacy and Clinic: switched on per
install (`company.module_lab`, 0023), enforced on the server with
`requireModule('lab')`, hidden — never deleted — when switched off.

The flow is the one the owner asked for (2083-08-04): **Billing → Sample
collection → Result entry → Approval → Reports. That's it.** In Result entry
each test is either done here or **sent to another laboratory**, test by test
(one bill can have both); a sent test goes straight to Reports. There is no
Dispatch step and no "report received / given to patient" tracking. The pages
are a ClinicNP-style port of an earlier laboratory product's tabs; that
product's name appears nowhere in ClinicNP (owner's instruction).

## Owner's decisions (2083-08-03)

| | Decision |
|---|---|
| Report delivery | **A QR code on the bill**, printed only when the bill carries a lab test. No SMS, no email. |
| The link | **Short** (`/r/<10 characters>`), opens the report **directly** — no phone check. Unguessable, and every view is logged. |
| Dues | The QR link shows nothing until the bill is **fully paid**. Staff can still print inside ClinicNP. |
| Referring doctor | **Typed name only** on the order and the report. No commission. |
| Reference ranges | Entered by KAHC's **lab in-charge**. Never seeded, guessed or copied in (Rules §2.2). |
| Sent-out tests | KAHC does **both**: its own laboratory, and some samples sent out (owner, 2083-08-03). **From Result entry, per test** (2083-08-04, 0027) — the counter-side send-out (`services.outsourced`, a partner picked at billing, `/sendout`) is retired; its old rows stay readable in statements and the books. |
| What a laboratory charges | **Each outside laboratory has its own price list** (Settings → Outside labs → the lab). A test sent there appears on it by itself; the owner fills in the price (2083-08-04). |
| Catalogue | **Emptied on 2083-08-09 (D-218)**; the owner adds tests, profiles and packages one by one. Same day, from the owner's report photos (D-219): 53 tests, 10 profiles and the Whole Body Checkup package (wbc, Rs 4000), tests and profiles at Rs 0 until priced. Before that: copied from the bgp install with **no rates and no ranges** (2083-08-04): 258 lab tests, 17 profiles; its 91 non-lab items became Clinic services. Histopathology became a lab department so its tests can be sent out. |
| Rates | **Aster Path Labs' MRP list** (2083-08-05, `import-templates/aster-price-list.xlsx`): 222 tests and profiles priced, 672 tests added (930 in all; departments Molecular & Genetics and Health Packages added). `import-templates/aster-price-match.csv` records every match and gap. Reference ranges are still the lab's to enter. |

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
   A **package** (`lab_test_groups.kind = 'package'`, 0029) holds profiles
   (`lab_test_group_profiles`) and single tests; billed, it opens every test in
   it once — a profile's tests under the profile's name, its single tests on
   their own — and a test both in a profile and on its own is done once.
4. Cancelling the bill cancels the order. A sale return of a lab line cancels
   its tests. A test already **sent to another laboratory** stays sent in both
   cases: the sample has gone, and that laboratory's charge is still owed.

## Sent to another laboratory (0027)

- Result entry lists a test only once its sample is collected (or it needs
  none). Each test there has **Send to another lab**; the toolbar's **Send
  tests to another lab** sends several at once. The person picks the
  laboratory.
- Sending sets the result to `sent_out` and writes a `lab_sendouts` row. The
  test leaves Result entry, skips Approval, and shows on Reports as
  "Vitamin D → City Lab". It is not printed on KAHC's report and the patient's
  QR page does not list it as still running.
- **Bring back** (on Result entry or the order page) undoes it, with a reason:
  the row keeps `cancelled_at`, the test returns to Result entry.
- **Price list** (`lab_partner_prices`): the first time a test is sent to a
  laboratory a row appears with no price. Setting the price charges every test
  already sent there without one — **dated the day the price is set**, so a
  closed fiscal year never changes. Later price changes apply to later sends.
- **Money**: `SENDOUT_MOVES_SQL` (lab-sendouts.ts) is the one reading of what a
  send-out owes — the charge on its charged date, and for an undone, charged
  send-out the reversal on the undo date. The partner's statement, balance,
  Payables and the ledger (Dr Outside laboratory charges, Cr the laboratory)
  all read it. The patient's bill is income from the lab as before.

## Workflow states

```
sample   waiting -> collected | rejected | recollection (-> waiting)
result   pending -> draft -> submitted -> approved
            |            \-> correction_required (sent back / reopened)
            \-> sent_out (-> pending when brought back)
order    sample_pending -> result_pending -> awaiting_approval
         -> approved (something to print) | sent_out (everything sent)
         (or cancelled)

"dispatched" is a hand-over stamp from before 0027; it reads as approved.
```

Reference ranges and flags are **snapshotted onto each value** when it is
entered, so a report always shows the range in force when it was validated.
Every submit and every change after approval writes a `lab_result_versions`
snapshot; approve / send back writes `lab_result_approvals`.

## The printed report (D-202)

`components/lab/report-sheet.tsx` draws the report for printing, for the
paged preview and for the patient's `/r/` page.

- A low, high or critical value and its `L` / `H` / `LL` / `HH` are weight
  800; normal values are 400. Weight, not colour, so it shows in black and
  white.
- A test's **Note on the report** (`lab_tests.description`) prints after the
  last test of its group, starting with the test's name; a test on its own has
  its note right under it. Tests billed in a package (`OrderResult.packageName`,
  found from the order test's bill line) put their notes together under
  **Notes** after all the results, just before End of report and the
  signatures. Method and the result's remarks stay under the test; the
  approver's interpretation prints in the Comments box.
- Line height 1.3 and tight padding, so more tests fit on a page; the font
  sizes are unchanged. The header row's underline is 25% ink.
- **Header (D-207, D-213):** left Name, Age / Gender, Referred by, Patient
  No., Address; right Lab ID No., Invoice No., Sample Collected on, Sample
  Received on (`lab_orders.received_at`, 0032, the first save in Result
  entry with a value), Report Released on (latest approval). Dates print as
  `08-08-2083 / 4:00 PM`, Nepal time.
- **Billed-only tests (D-214):** result type "None" (Ultrasound, ECG). Never
  on a lab order, sample, Result entry or the report; listed under its
  package on the bill. Switching a test to None takes its unapproved results
  off open orders.
- **Boxes (D-208):** each profile is its own bordered table headed by its
  name; a department's single tests share one box. Signatures are 66 px tall.
- **Notes (D-216):** Settings → Lab report → Notes on the report: one at the
  foot of every page, one once at the end.
- **Approval (D-209):** no choosing; the active signatures (up to 3, in their
  set order) sign every report.

## Pages and permissions

| Page | Route | Permission |
|---|---|---|
| Sample collection, labels | `/lab/samples`, `/print/lab-label/[id]` | `lab.samples` |
| Result entry | `/lab/results`, `/lab/results/[orderId]` | `lab.results` |
| Approval | `/lab/approval`, `/lab/approval/[orderId]` | `lab.approve` |
| Reports (print; sent-out tests listed) | `/lab/reports`, `/print/lab-report/[orderId]` | `lab.reports` |
| Send to another lab, bring back | on Result entry and the order page | `lab.results` |
| Order detail | `/lab/orders/[orderId]` | any lab permission; reopen needs `lab.reopen` |
| Tests (list; each test on its own page) | `/lab/tests`, `/lab/tests/new`, `/lab/tests/[id]` | `lab.catalog` |
| Profiles | `/lab/profiles` | `lab.catalog` |
| Packages (profiles and tests at one price, 0029) | `/lab/packages` | `lab.catalog` |
| Outside labs and their price lists | `/settings/lab-partners`, `/settings/lab-partners/[id]` | `lab.catalog` or `clinic.setup` |
| Departments, sample types, report letterhead, signatures | Settings → Laboratory | `lab.catalog` |
| Patient's report | `/r/[token]` | public, rate-limited |

The counter-side send-out pages (`/sendout/*`, `lab.sendout`) and the
Dispatch tab (`lab.dispatch`) were removed by 0027; 0028 takes both keys out
of saved roles.

## Libraries added (Rules §3)

- `qrcode` — the QR on the bill and the report. Loaded only when printing.
- `bwip-js` — Code 128 barcodes on sample labels and reports.
- *(`pagedjs` was removed on 2083-08-09, D-217: the browser lays the report
  out; the letterhead, signatures and page note repeat through the sheet's
  table header and footer, and "Page X of Y" sits in the page margin.)*
