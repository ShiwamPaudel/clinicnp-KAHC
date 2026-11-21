# Accounting.md — the books

Full double-entry accounts with party ledgers and aging, built for Koshi
Aarogya Healthcare (owner's scope, 2083-08-03). Not behind a module: every
install keeps books. Migration 0025.

## The one idea

**The books are read from what the app already records.** Bills, returns,
dues payments, purchases, purchase returns, supplier and laboratory payments,
stock out and opening stock are turned into debit and credit lines when a
report is opened (`src/lib/repos/ledger.ts`, `JOURNAL_SQL`). Nothing is
copied into a second table. So:

- the books can never disagree with a bill, the Dues list, a supplier's page
  or the laboratory statement — they read the same rows;
- the counter, the outbox and `ingestBill` did not change (Rules §0.2);
- a fix to how something posts fixes the past too, which is why the posting
  rules below are tested end to end (`tests/accounting.integration.test.ts`).

Only what the app has no screen for is entered by hand, as a **voucher**:
expenses, cash ↔ bank, capital and loans, doctors' payouts, other parties,
opening balances. A voucher is never edited or deleted; cancelling reverses it
on the day it is cancelled and keeps the original on its own day.

## What each document posts

| Document | Debit | Credit |
|---|---|---|
| Bill | Cash or QR (paid now); Patients' dues (left owing, from `OWED_AT_SALE_SQL`); Discount allowed (shared across the parts by amount, the leftover paisa to Clinic); Cost of medicines sold (batch cost); Doctors' shares; Outside laboratory charges | Medicine sales / Clinic services / Laboratory tests / Tests sent out; VAT collected; Medicine stock; the doctor; the laboratory; rounding either way |
| Cancelled bill | the bill, reversed on the day it was cancelled (`bills.cancelled_at`, new) | |
| Return / refund | the income it came from; stock back at batch cost; the doctor's share taken back in proportion; a refunded sent-out test off the laboratory | Patients' dues (taken off what is owed first); Cash (handed back) |
| Dues payment | Cash or QR | Patients' dues — undone on the day it is voided |
| Purchase | Medicine stock (after line discounts, matching batch cost); VAT paid; rounding | Discount received (bill discount); the supplier |
| Purchase return | the supplier | Medicine stock |
| Test sent out (Result entry, 0027) | Outside laboratory charges — on the day the laboratory's price became known; an undo reversed on its day | the laboratory |
| Supplier / lab payment | the supplier / laboratory | Cash, QR, or the bank chosen ("Bank (account not chosen)" when none) |
| Stock out | the reason's expense (written off / clinic use / free samples / count difference) | Medicine stock. A return to the supplier posts once, as its purchase return |
| Opening stock | Medicine stock | Opening balances (to be moved) |

Parts of the clinic (P&L columns): a service is **Laboratory** when it belongs
to a lab test or profile, **Tests sent out** (Laboratory column) when it was
sent out from the counter before 0027, otherwise **Clinic**. Medicines are
**Pharmacy**. A lab test sent out from Result entry stays Laboratory income;
what the other laboratory charges is the Outside laboratory charges expense.

## Parties

| Party | Control account | Where money moves |
|---|---|---|
| Patient / customer on dues | Patients' dues | Dues list (bill by bill, `lib/dues.ts`) |
| Supplier | Suppliers | Supplier page (now offers the bank) |
| Outside laboratory | Outside laboratories | Laboratory statement (now offers the bank) |
| Doctor | Doctors' shares | Payment voucher |
| Other party (landlord, insurer, company client, staff, lender) | Other parties (receivable or payable, by the party's side) | Vouchers |

Vouchers may not name patients, suppliers or laboratories (only openings may
name suppliers and laboratories), so those balances keep one home each.
Opening balances for suppliers and laboratories also show on their own pages
(`repos/party-openings.ts`).

## Aging

From the **bill date** (owner, 2083-08-03), in 0–30, 31–60, 61–90, 91–120 and
over 120 days. Patients' dues age bill by bill exactly as the Dues list
shows. Everyone else is settled **oldest first** (`openItemsOldestFirst`); an
opening line naming an old bill keeps that bill's number and date.

## Years

Income and expense accounts start again at zero each fiscal year; what earlier
years came to shows as "Profit of earlier years". Nothing is closed or carried
by hand. A voucher dated in a closed year is refused.

## Screens and permissions

`/accounts` — Overview, Vouchers, Day book, Parties, Aging, Trial balance,
Profit and loss (Pharmacy / Clinic / Laboratory / Whole clinic), Balance
sheet, Chart of accounts, Checks. Ledgers at `/accounts/ledger/[account]`
(cash book and bank book included), statements at
`/accounts/parties/[type]/[id]`. Every statement prints and the main ones
download to Excel (`/api/accounts-export/*`).

| Permission | Allows |
|---|---|
| `accounts.view` | every book and report |
| `accounts.post` | enter and cancel payment, receipt, transfer and journal vouchers |
| `accounts.setup` | chart of accounts, other parties, opening balances |

The Accountant role got all three (if unedited since 0022).

## Checks (`/accounts/checks`)

Debits equal credits; Patients' dues equal the Dues list; Suppliers equal their
pages; Outside laboratories equal Payables; Medicine stock equals the shelf at
cost (a few rupees of rounding is normal); no bank payment left without a
bank; opening balances moved to capital; QR money moved to the bank.

## Not built yet (waiting on the owner)

- Bank and wallet accounts: added by the accountant under Chart of accounts.
- Insurance / SSF / corporate credit billing at the counter (bill to a party
  instead of a patient).
- TDS: an account exists ("TDS to deposit"); no rates are set or applied.
- Patients' opening dues from the old software.
- A Tally export.
- Matching a supplier payment to a chosen bill (payments clear the oldest
  bill first today).

Not wanted: **bank reconciliation** (owner, 2083-08-04). The books record
every bill, purchase, payment and voucher; nobody ticks them off against a
bank statement.
