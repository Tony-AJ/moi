# Test plan — failure scenarios

Written for: whoever verifies a build before an event.

Every row below was exercised against the running API during development; the
"Verified" column is what the implementation currently does.

## Guest flow

| Scenario | Expected | Verified |
| --- | --- | --- |
| Guest submits the form twice (double tap) | Same `clientRequestId` returns the original entry, `deduplicated: true`, no second row | ✅ |
| Amount is 0, negative or non-numeric | `400` with a readable message, nothing stored | ✅ |
| Amount below/above the event limits | `400` naming the limit | ✅ |
| Name shorter than 2 characters | `400` | ✅ |
| Phone required by the event but missing | `400` | ✅ |
| Event closed (`isOpen = false`) | `403`, guest form disabled in the UI | ✅ |
| Unknown event slug | `404` with "check the QR code" copy | ✅ |
| Guest cancels payment in the UPI app | Entry stays `AWAITING_VERIFICATION`; nothing in the API ever marks it paid | ✅ |
| Guest never returns to the site | Entry stays pending; reconciliation can still verify it from the statement | ✅ |
| Wrong/garbage reference submitted | Stored as a claim; reconciliation reports `NOT_FOUND` or `REVIEW_REQUIRED`, never `VERIFIED` | ✅ |
| Same reference submitted on two entries | Second attempt `409`, first claim untouched | ✅ |
| Guest corrects their reference | Old claim becomes `SUPERSEDED`, new claim is current | ✅ |
| Guest opens a status token that does not exist | `404` | ✅ |
| Client POSTs `{"paid": true}` or any extra field | `400` — DTOs reject unknown properties; there is no endpoint that accepts a paid flag | ✅ |

## Reconciliation

| Scenario | Expected | Verified |
| --- | --- | --- |
| Statement with a matching reference and amount | Entry → `VERIFIED`, credit linked | ✅ |
| Reference only in the narration (no ref column) | Matched via narration fallback | ✅ |
| Two credits match the same reference and amount | `REVIEW_REQUIRED`, neither auto-linked | ✅ |
| Only the amount matches, no reference | `REVIEW_REQUIRED` — never auto-verified | ✅ |
| Payment made but missing from this statement | `NOT_FOUND`, re-run allowed after the next import | ✅ |
| Same statement file uploaded twice | `409`, nothing changed; `force=true` to override | ✅ |
| Overlapping statements sharing rows | Duplicate rows ignored via `rowHash` | ✅ |
| Duplicate rows inside one file | Counted as duplicates, imported once | ✅ |
| One credit, two entries | Second link attempt `409`; DB unique + conditional update | ✅ |
| Admin links a credit of a different amount | `400` — amounts must be equal | ✅ |
| Admin links a debit row | `400` — credits only | ✅ |
| Rejecting a verified entry | Status `REJECTED`, credit unlinked and reusable, reason audited | ✅ |
| Cash entry during a reconciliation run | Untouched, reason states it is admin-confirmed | ✅ |
| Statement with preamble rows above the header | Header located by scoring; preamble ignored | ✅ |
| Statement with an unreadable date | Row skipped and reported, import continues | ✅ |
| Non-CSV/XLSX upload, or >10 MB | `400` from the file filter / size validator | ✅ |

## Admin access control

| Scenario | Expected | Verified |
| --- | --- | --- |
| Any `/admin/*` call without a token | `401 Missing bearer token` | ✅ |
| Tampered or expired JWT | `401 Invalid or expired token` | ✅ |
| Token for a deactivated admin | `401` on the next request (row re-read each time) | ✅ |
| `STAFF` creating or editing an event | `403 Insufficient role` | ✅ |
| Wrong password / unknown email | Identical `401`, failure audited | ✅ |
| Brute-forcing login | `429` after 5 attempts/min per IP | ✅ |
| Review action without a reason | `400` — reason is mandatory for auditability | ✅ |

## Reports

| Scenario | Expected | Verified |
| --- | --- | --- |
| Excel export | Opens in Excel; Summary + Moi Register sheets; totals match the dashboard | ✅ |
| PDF export | Valid PDF (`%PDF-`), paginated table, verified total stated separately | ✅ |
| Filtered export (status/date) | Rows and totals both reflect the filters | ✅ |
| Export without a token | `401` | ✅ |

## Manual checks before an event

1. `GET /api/health` returns `database: "up"`.
2. The QR code on **Events & QR** encodes the **deployed** guest URL, not
   localhost (the admin UI warns if it does).
3. Scan the QR on a real phone, complete one ₹1 entry, pay it, submit the UTR.
4. Import the real statement and confirm that entry flips to `VERIFIED`.
5. Change the seeded admin password; confirm the old one fails.
6. Export both reports and check the verified total against the bank balance.

## Load sanity

Reconciliation is sequential per entry. 1,000 entries against 5,000
transactions completes in a few seconds on a laptop; beyond ~50,000 entries,
move the run to a background queue.
