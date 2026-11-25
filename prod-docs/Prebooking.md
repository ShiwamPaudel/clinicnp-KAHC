# Pre-Booking (0031)

A patient rings the day before: "TFT, I'll come at 8 tomorrow." The front desk
books the name, phone and time, and the tests or services. When they arrive the
booking is issued as a bill. Some pay something beforehand (owner, 2083-08-06).

## The screen

Menu **Pre-Booking** (`/prebooking`, was Doctors; `/doctors` redirects). One day
at a time:

- **Tests and services booked** — `prebookings` with `kind = 'tests'`. Any
  service can be booked: lab tests, profiles, packages, X-ray, USG. Every
  booking is for a registered patient (D-201): **Book tests** searches patients
  by name, phone or number (`PatientPicker`, as on a doctor's day) and
  **Register someone new** registers them from the dialog. The booking keeps
  the patient's name and phone as they were when it was saved. A new patient is
  registered only after `checkTestBooking` passes, so a booking that cannot be
  saved leaves no stray patient behind. Bookings made before D-201 may have no
  patient; changing one asks for the patient.
- **Doctors' consultations** — the day's `appointments`, every doctor. A
  consultation gets a `prebookings` row (`kind = 'consultation'`,
  `appointment_id`) the first time an advance is taken on it or a bill issued.
- **Book a consultation** — the doctor cards, each opening the doctor's day.

The booking dialog shows the **Total** of the booked services at today's
rates; the counter can still change a rate when the bill is made.

Actions on a waiting booking: **Issue bill**, **Advance**, change (tests only),
close (**Cancelled** or **Did not come**). Permission `appointments.manage`;
Issue bill also needs `counter.use`.

## Follow-up (0035, D-221)

**Follow-up** on the patient's page: date, time, an optional doctor, a note.
With a doctor: that doctor's consultation, reason "Follow-up", under Doctors'
consultations. Without: a tests booking with `is_followup = 1` that may have
no tests until they come (Change adds them; Issue bill opens the counter with
the patient on it), shown with a **Follow-up** badge. The patient's page shows
the next one still waiting.

## Money

An advance is not income: it is owed back to the patient until a bill uses it,
in **Advances from patients** (`sys:patient_advances`, 2040, app-only).

| Event | Row | Debit | Credit |
|---|---|---|---|
| Advance taken (receipt AR-000001, `/print/advance/[id]`) | `advance_moves` received | Cash or QR | Advances from patients |
| Bill issued from the booking | the bill is saved **on dues** for the part the advance covers; a `due_payments` row, method `advance`, `prebooking_id`, clears it | Advances from patients | Patients' dues |
| Advance more than the bill | `advance_moves` refunded, `bill_id`, cash ("Change from bill …") | Advances from patients | Cash |
| Booking cancelled / did not come | `advance_moves` refunded, cash or QR (defaults to how it came in) | Advances from patients | Cash or QR |
| Bill cancelled | its `advance` dues payment is voided the same moment; the booking is waiting again with its advance | (dues payment undone) | |

Advance in hand = received − refunded − used (not voided).

- `ingestBill` reads the booking inside its transaction (`bookingTermsTx`). A
  booking not still waiting brings nothing, so issuing it twice never uses the
  advance twice.
- An `advance` dues payment cannot be undone from Dues; cancelling the bill gives
  it back.
- A consultation holding an advance cannot be cancelled from the doctor's day;
  it is closed from Pre-Booking so the refund is recorded.

## The counter

`/billing?prebooking=<id>` puts the booking on the counter once the catalogue
is loaded: its services, its patient already attached, and a banner. (An old
booking with no patient opens the patient bar with the name typed.) The payment pane shows **Advance
paid**, **To pay**, and **Hand back from advance** when the advance is more than
the bill. The printed bill and its reprint show "Advance paid (AR-…)"; Balance
due is what is left after the advance.

## Day close

`byMethod.advance` is today's bills paid from advances (so cash + QR + dues +
advance = gross sales). `advances` lists advances taken and handed back today by
cash and QR; expected cash = cash bills + dues paid in cash + advances taken in
cash − advances handed back in cash − returns handed back.
