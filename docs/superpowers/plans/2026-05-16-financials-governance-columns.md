# Financials Tab — Governance Columns & SR-025 Flip Detection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add governance comparison columns (COI policy, whistleblower policy, document retention, independent members) and a Part IV related-party disclosure row to the Financials tab, with automatic SR-025 FALSE_DISCLOSURE detection when a year flips from "Yes" to "No."

**Architecture:** The IRS connector already parses all governance data from 990 XML into `parsed.governance.*` — it just isn't saved to the model or returned by the API. This plan adds 4 nullable BooleanFields to `FinancialSnapshot`, wires them through the `fetch990s` view and `api_case_financials` response, updates the TypeScript type, and renders two new table sections in `FinancialsTab.tsx`. SR-025 flip detection is a pure frontend function that scans year-over-year `related_party_disclosed` values.

**Tech Stack:** Django 4.2, PostgreSQL 16, React 18, TypeScript, Vite

---

## File Map

| File | Change |
|------|--------|
| `backend/investigations/models.py` | Add 4 BooleanFields to `FinancialSnapshot` |
| `backend/investigations/migrations/0027_financialsnapshot_governance_fields.py` | Auto-generated migration |
| `backend/investigations/views.py` | Two edits: wire fields in `fetch990s` create call; add fields to `api_case_financials` response |
| `frontend/src/types/index.ts` | Add 6 fields to `FinancialSnapshot` interface |
| `frontend/src/views/FinancialsTab.tsx` | Add `GovernanceCell`, governance `<tbody>`, Part IV `<tbody>`, SR-025 flip logic |

---

## Task 1: Add governance fields to FinancialSnapshot model

**Files:**
- Modify: `backend/investigations/models.py`

- [ ] **Open `models.py` and find the `FinancialSnapshot` class. After line `num_independent_members = models.IntegerField(null=True, blank=True)` (currently the last field before `# Source tracking`), add this block:**

```python
    # Governance (Part IV checklist + Part VI indicators — from IRS XML)
    related_party_disclosed = models.BooleanField(
        null=True,
        blank=True,
        help_text="Part IV Line 28 — org had related-party transactions (schedule_l_required)",
    )
    has_coi_policy = models.BooleanField(
        null=True,
        blank=True,
        help_text="Part VI Line 12a — conflict of interest policy exists",
    )
    has_whistleblower_policy = models.BooleanField(
        null=True,
        blank=True,
        help_text="Part VI Line 13 — whistleblower policy exists",
    )
    has_document_retention_policy = models.BooleanField(
        null=True,
        blank=True,
        help_text="Part VI Line 14 — document retention policy exists",
    )
```

- [ ] **Verify the full field block now reads (num_employees through new fields):**

```python
    officer_compensation_total = models.BigIntegerField(null=True, blank=True)
    num_employees = models.IntegerField(null=True, blank=True)
    num_voting_members = models.IntegerField(null=True, blank=True)
    num_independent_members = models.IntegerField(null=True, blank=True)

    # Governance (Part IV checklist + Part VI indicators — from IRS XML)
    related_party_disclosed = models.BooleanField(null=True, blank=True,
        help_text="Part IV Line 28 — org had related-party transactions (schedule_l_required)")
    has_coi_policy = models.BooleanField(null=True, blank=True,
        help_text="Part VI Line 12a — conflict of interest policy exists")
    has_whistleblower_policy = models.BooleanField(null=True, blank=True,
        help_text="Part VI Line 13 — whistleblower policy exists")
    has_document_retention_policy = models.BooleanField(null=True, blank=True,
        help_text="Part VI Line 14 — document retention policy exists")

    # Source tracking
    source = models.CharField(...)
```

---

## Task 2: Generate and verify the migration

**Files:**
- Create: `backend/investigations/migrations/0027_financialsnapshot_governance_fields.py` (auto-generated)

- [ ] **Run makemigrations from the `backend/` directory:**

```bash
cd backend && python manage.py makemigrations investigations --name governance_fields_financialsnapshot
```

Expected output:
```
Migrations for 'investigations':
  investigations/migrations/0027_governance_fields_financialsnapshot.py
    - Add field has_coi_policy to financialsnapshot
    - Add field has_document_retention_policy to financialsnapshot
    - Add field has_whistleblower_policy to financialsnapshot
    - Add field related_party_disclosed to financialsnapshot
```

- [ ] **Open the generated migration file and confirm it contains `AddField` operations for all 4 fields and no unexpected changes.**

- [ ] **Apply the migration:**

```bash
python manage.py migrate investigations
```

Expected output ends with:
```
  Applying investigations.0027_governance_fields_financialsnapshot... OK
```

---

## Task 3: Wire governance fields in the fetch990s view

**Files:**
- Modify: `backend/investigations/views.py` (the `FinancialSnapshot.objects.create(...)` call inside `api_fetch_990s`)

- [ ] **Find the `FinancialSnapshot.objects.create(...)` block in `api_fetch_990s`. It currently ends with:**

```python
                num_voting_members=(parsed.governance.voting_members_governing_body),
                num_independent_members=(parsed.governance.independent_voting_members),
                # Metadata
                source="IRS_TEOS_XML",
```

- [ ] **Add the 4 governance fields between `num_independent_members` and `# Metadata`:**

```python
                num_voting_members=(parsed.governance.voting_members_governing_body),
                num_independent_members=(parsed.governance.independent_voting_members),
                # Governance — Part IV + Part VI (already parsed from XML)
                related_party_disclosed=parsed.governance.schedule_l_required,
                has_coi_policy=parsed.governance.conflict_of_interest_policy,
                has_whistleblower_policy=parsed.governance.whistleblower_policy,
                has_document_retention_policy=parsed.governance.document_retention_policy,
                # Metadata
                source="IRS_TEOS_XML",
```

- [ ] **Run ruff to confirm no lint errors in views.py:**

```bash
cd backend && ruff check investigations/views.py
```

Expected: no output (zero errors).

---

## Task 4: Add governance fields to the financials API response

**Files:**
- Modify: `backend/investigations/views.py` (the `api_case_financials` view, `row` dict)

- [ ] **Find `api_case_financials`. The `row` dict currently ends with:**

```python
            "num_employees": s.num_employees,
            "source": s.source,
            "confidence": s.confidence,
```

- [ ] **Replace that block with:**

```python
            "num_employees": s.num_employees,
            "num_voting_members": s.num_voting_members,
            "num_independent_members": s.num_independent_members,
            "related_party_disclosed": s.related_party_disclosed,
            "has_coi_policy": s.has_coi_policy,
            "has_whistleblower_policy": s.has_whistleblower_policy,
            "has_document_retention_policy": s.has_document_retention_policy,
            "source": s.source,
            "confidence": s.confidence,
```

- [ ] **Run ruff again:**

```bash
cd backend && ruff check investigations/views.py
```

Expected: no output.

- [ ] **Smoke-test the endpoint manually (requires a running dev server with at least one FinancialSnapshot in the DB):**

```bash
# From backend/ with server running on port 8000
curl -s "http://localhost:8000/api/cases/<any-case-id>/financials/" | python -m json.tool | grep -E "related_party|has_coi|has_whistle|has_doc"
```

Expected: the 4 new fields appear in the JSON (values will be `null` for pre-existing snapshots — that's correct).

- [ ] **Commit backend changes:**

```bash
git add backend/investigations/models.py \
        backend/investigations/migrations/0027_governance_fields_financialsnapshot.py \
        backend/investigations/views.py
git commit -m "feat(financials): add governance fields to FinancialSnapshot and API response

Add has_coi_policy, has_whistleblower_policy, has_document_retention_policy,
related_party_disclosed to FinancialSnapshot. Wire from parsed.governance.*
in fetch990s view. Return all governance + num_voting/independent_members
from api_case_financials."
```

---

## Task 5: Update the TypeScript FinancialSnapshot interface

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Find the `FinancialSnapshot` interface. It currently ends with:**

```typescript
  num_employees: number | null;
  /** "IRS_XML" for TEOS pipeline data, "AI_EXTRACTED" for OCR-parsed documents */
  source: "IRS_XML" | "AI_EXTRACTED";
```

- [ ] **Replace those two lines with:**

```typescript
  num_employees: number | null;
  num_voting_members: number | null;
  num_independent_members: number | null;
  /** Part IV Line 28 — org disclosed related-party transactions. null if not parsed. */
  related_party_disclosed: boolean | null;
  /** Part VI Line 12a — conflict of interest policy. null if not parsed. */
  has_coi_policy: boolean | null;
  /** Part VI Line 13 — whistleblower policy. null if not parsed. */
  has_whistleblower_policy: boolean | null;
  /** Part VI Line 14 — document retention policy. null if not parsed. */
  has_document_retention_policy: boolean | null;
  /** "IRS_TEOS_XML" for TEOS pipeline data, "EXTRACTED" for OCR-parsed documents */
  source: string;
```

- [ ] **Run the TypeScript compiler to catch any type errors introduced:**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors referencing `FinancialSnapshot` (there may be pre-existing errors elsewhere — only fix errors in the files we're touching).

---

## Task 6: Add GovernanceCell component and governance section

**Files:**
- Modify: `frontend/src/views/FinancialsTab.tsx`

- [ ] **After the `AnomalyCell` component (around line 193, before `export default function FinancialsTab`), add the `GovernanceCell` component:**

```tsx
// ---------------------------------------------------------------------------
// GovernanceCell — boolean governance indicator (Yes / No / unknown)
// ---------------------------------------------------------------------------

function GovernanceCell({ value, year }: { value: boolean | null; year: number }) {
  if (value === null || value === undefined) {
    return <td key={year} style={{ color: "var(--text-3)", textAlign: "right" }}>—</td>;
  }
  if (value) {
    return <td key={year} className="cell--gov-pass" style={{ textAlign: "right" }}>Yes</td>;
  }
  return <td key={year} className="cell--gov-fail" style={{ textAlign: "right" }}>No</td>;
}
```

- [ ] **In `index.css` (or wherever the fin-table cell classes live), add two new classes. Search for `cell--flag` to find the right location, then add after it:**

```css
.cell--gov-pass {
  color: var(--color-medium, #34d399);
}
.cell--gov-fail {
  background: rgba(239, 68, 68, 0.08);
  color: var(--color-critical, #f87171);
  font-weight: 600;
}
```

- [ ] **In `FinancialsTab.tsx`, find the closing `</tbody>` of the existing financial rows (after the officer compensation row). After it and before `</table>`, add the governance section:**

```tsx
          <tbody>
            {/* ── Section header ── */}
            <tr className="fin-section-header">
              <td colSpan={years.length + 1}>Governance — Part VI</td>
            </tr>

            {/* ── Board members ── */}
            <tr>
              <td>Board members</td>
              {snapshots.map((s) => (
                <td key={s.tax_year} style={{ textAlign: "right" }}>
                  {s.num_voting_members ?? "—"}
                </td>
              ))}
            </tr>

            {/* ── Independent members ── */}
            <tr>
              <td>Independent members</td>
              {snapshots.map((s) => {
                const val = s.num_independent_members;
                if (val === null || val === undefined) {
                  return <td key={s.tax_year} style={{ textAlign: "right", color: "var(--text-3)" }}>—</td>;
                }
                return (
                  <td
                    key={s.tax_year}
                    style={{ textAlign: "right" }}
                    className={val === 0 ? "cell--gov-fail" : "cell--gov-pass"}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>

            {/* ── COI policy ── */}
            <tr>
              <td>COI policy</td>
              {snapshots.map((s) => (
                <GovernanceCell key={s.tax_year} value={s.has_coi_policy} year={s.tax_year} />
              ))}
            </tr>

            {/* ── Whistleblower policy ── */}
            <tr>
              <td>Whistleblower policy</td>
              {snapshots.map((s) => (
                <GovernanceCell key={s.tax_year} value={s.has_whistleblower_policy} year={s.tax_year} />
              ))}
            </tr>

            {/* ── Document retention policy ── */}
            <tr>
              <td>Document retention</td>
              {snapshots.map((s) => (
                <GovernanceCell key={s.tax_year} value={s.has_document_retention_policy} year={s.tax_year} />
              ))}
            </tr>
          </tbody>
```

- [ ] **Add the `fin-section-header` CSS class near the other fin-table classes:**

```css
.fin-section-header td {
  background: var(--bg-1, #111827);
  color: var(--text-3, #6b7280);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 10px 12px 4px;
  border-top: 1px solid var(--border-1, #374151);
}
```

- [ ] **Run the TypeScript check to catch JSX errors:**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "FinancialsTab"
```

Expected: no output.

---

## Task 7: Add Part IV section with SR-025 flip detection

**Files:**
- Modify: `frontend/src/views/FinancialsTab.tsx`

- [ ] **After the existing pure helper functions (after `zeroCompTitle`), add the SR-025 flip detector:**

```typescript
/**
 * Returns the set of tax_years that are flagged for SR-025 FALSE_DISCLOSURE.
 *
 * Logic: find the first year where related_party_disclosed === true.
 * Every subsequent year where it is false is a flip — the org told the IRS
 * there were no related-party transactions after previously disclosing them.
 */
function detectSr025FlipYears(snapshots: FinancialSnapshot[]): Set<number> {
  const flipped = new Set<number>();
  let firstYesYear: number | null = null;
  for (const s of snapshots) {
    if (s.related_party_disclosed === true && firstYesYear === null) {
      firstYesYear = s.tax_year;
    } else if (s.related_party_disclosed === false && firstYesYear !== null) {
      flipped.add(s.tax_year);
    }
  }
  return flipped;
}
```

- [ ] **In the main `FinancialsTab` component body, compute the flip set alongside the other derived data:**

```typescript
  const sr025FlipYears = detectSr025FlipYears(snapshots);
```

Place this line immediately after `const sourceLabel = dominantSourceLabel(snapshots);`.

- [ ] **After the governance `</tbody>` block added in Task 6 and before `</table>`, add the Part IV section:**

```tsx
          <tbody>
            {/* ── Section header ── */}
            <tr className="fin-section-header">
              <td colSpan={years.length + 1}>Part IV — Related-party disclosure</td>
            </tr>

            {/* ── Line 28 — Related-party transaction disclosed ── */}
            <tr>
              <td>Line 28 — Related-party tx disclosed?</td>
              {snapshots.map((s) => {
                const isFlip = sr025FlipYears.has(s.tax_year);
                if (isFlip) {
                  return (
                    <AnomalyCell
                      key={s.tax_year}
                      value="No"
                      ruleId="SR-025"
                      ruleLabel="FALSE_DISCLOSURE"
                      explanation={
                        `SR-025 · FALSE_DISCLOSURE — ${s.tax_year} 990 denies related-party ` +
                        `transactions (Line 28 = No), but a prior year disclosed them (Line 28 = Yes). ` +
                        `Transactions continued. This is not an accidental omission.`
                      }
                      onStartAngle={onStartAngle}
                    />
                  );
                }
                return (
                  <GovernanceCell
                    key={s.tax_year}
                    value={s.related_party_disclosed}
                    year={s.tax_year}
                  />
                );
              })}
            </tr>
          </tbody>
```

- [ ] **Run the full TypeScript check:**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `FinancialsTab.tsx` or `types/index.ts`.

---

## Task 8: Build, verify visually, and commit

- [ ] **Run the Vite production build to confirm no build errors:**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected output ends with something like:
```
✓ built in Xs
```

- [ ] **Start the Vite dev server and open a case with Form 990 data:**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173/cases/<case-id>` → Financials tab.

**Verify:**
- Governance section appears below the existing financial rows
- Board members and independent member counts show correctly
- COI / Whistleblower / Document Retention show "No" (red) for Bright Future data
- Part IV section appears below governance
- If the case has IRS XML 990s: the year with `related_party_disclosed = true` shows green "Yes", subsequent years with `false` show red "No" with SR-025 badge
- Clicking a SR-025 cell opens the AnomalyCell popover with the FALSE_DISCLOSURE explanation and "Start new angle" button

- [ ] **If snapshots were fetched before this change (governance fields will be null), re-fetch 990s to populate the new fields:**

In the app: Research tab → IRS 990 → search by EIN → Fetch 990s → switch to Financials tab.

The governance cells should now show real Yes/No values.

- [ ] **Commit the frontend changes:**

```bash
git add frontend/src/types/index.ts frontend/src/views/FinancialsTab.tsx
git commit -m "feat(financials): governance columns + SR-025 flip detection in Financials tab

Add Governance section (COI, whistleblower, document retention, board/independent
members) and Part IV section (related-party disclosure Line 28) to the year-over-year
table. SR-025 FALSE_DISCLOSURE fires automatically when related_party_disclosed flips
from true to false across years. GovernanceCell renders Yes/No/unknown with colour coding."
```

---

## Self-Review

**Spec coverage:**
- ✅ Governance columns (COI, Whistleblower, Document Retention, Independent Members) — Tasks 6-7
- ✅ Part IV Line 28 year-over-year flip — Task 7 (`detectSr025FlipYears`)
- ✅ SR-025 CRITICAL badge with popover — Task 7 (reuses `AnomalyCell`)
- ✅ Backend model fields — Task 1
- ✅ Migration — Task 2
- ✅ fetch990s wiring — Task 3
- ✅ API response — Task 4
- ✅ TypeScript types — Task 5

**Placeholder scan:** No TBDs, TODOs, or "similar to" references. All code blocks are complete.

**Type consistency:**
- `GovernanceCell` defined in Task 6, used in Tasks 6 and 7 ✅
- `detectSr025FlipYears` defined in Task 7, called in Task 7 ✅
- `related_party_disclosed`, `has_coi_policy`, `has_whistleblower_policy`, `has_document_retention_policy` added to model in Task 1, wired in Task 3, returned in Task 4, typed in Task 5, consumed in Tasks 6-7 ✅
- `num_voting_members`, `num_independent_members` already on model — added to API response in Task 4, typed in Task 5, rendered in Task 6 ✅

**CSS classes:**
- `cell--gov-pass`, `cell--gov-fail` defined in Task 6 ✅
- `fin-section-header` defined in Task 6, used in Tasks 6 and 7 ✅
