# 990 Schedule L/R/O Extraction & Signal Rule Upgrade

**Date:** 2026-05-27  
**Status:** Approved — ready for implementation  
**Subsystem:** A of 5 (990 schedules → then UCC burst, parcel signals, audit signals, deed authorization)

---

## Context

Catalyst's `FinancialSnapshot` stores Part I revenue/expenses, Part X balance sheet, and
Part IV/VI governance booleans extracted from IRS 990 XML. Three schedules that carry the
most forensically significant data are not currently parsed:

- **Schedule L** — Related-party transactions (names, relationships, dollar amounts)
- **Schedule R** — Related organizations (EINs, org types, descriptions)
- **Schedule O** — Supplemental explanations (the org's own written disclosures)

As a result, SR-025 (false disclosure) must infer related-party activity from OCR text
patterns and cross-referencing the `Relationship` model — a fragile approach. SR-028
(material diversion) fires correctly but its evidence snapshot only contains a boolean
flag rather than the org's own explanation text.

The document schema seed file from the companion platform supplies the exact IRS XML
element paths needed to extract all three schedules.

---

## Approach: Targeted extraction layer (Approach A)

- `ScheduleLTransaction` — new normalized model (FK to `FinancialSnapshot`) so SR-025
  can query by ORM rather than looping Python lists
- `schedule_r_orgs` and `schedule_o_explanations` — JSONFields on `FinancialSnapshot`
  (these are read/displayed, not filtered by ORM)
- `_parse_schedules()` — new isolated function in `irs_connector.py`
- SR-025 upgraded with two new modes; SR-028 evidence enriched
- Two new rules: SR-030 (Schedule L disclosure flag), SR-031 (zero independent members)

Not in scope: entity resolution linking Schedule L parties to existing `Person`/`Organization`
records (Approach B — deferred to a follow-on).

---

## Data Model

### New model: `ScheduleLTransaction`

```python
class ScheduleLTransaction(UUIDPrimaryKeyModel):
    snapshot     = FK(FinancialSnapshot, on_delete=CASCADE, related_name="schedule_l_transactions")
    case         = FK(Case, on_delete=RESTRICT, related_name="schedule_l_transactions")
    tax_year     = IntegerField()                    # denormalized from snapshot
    party_name   = CharField(max_length=500)         # named party in the transaction
    relationship_description = TextField(default="") # "officer", "family member of director"
    transaction_description  = TextField(default="") # what the transaction was
    amount       = BigIntegerField(null=True, blank=True)  # nullable — some entries blank

    class Meta:
        db_table = "schedule_l_transactions"
        indexes = [
            Index(fields=["case"],     name="idx_sched_l_case"),
            Index(fields=["snapshot"], name="idx_sched_l_snapshot"),
            Index(fields=["amount"],   name="idx_sched_l_amount"),
        ]
```

**Why `case` is denormalized:** SR-025 queries `ScheduleLTransaction.objects.filter(case=case)`
directly. Going through `snapshot__case` on every signal evaluation adds an unnecessary join.

### New fields on `FinancialSnapshot`

```python
schedule_r_orgs = JSONField(default=list, blank=True,
    help_text="Schedule R related organizations: [{name, ein, org_type, description}]")

schedule_o_explanations = JSONField(default=list, blank=True,
    help_text="Schedule O supplemental explanations: [{form_line_reference, explanation_text}]")
```

### Migration

One migration: `AddField` × 2 on `FinancialSnapshot`, `CreateModel` for `ScheduleLTransaction`.

---

## IRS Connector Parsing (`irs_connector.py`)

### XML structure

Schedules are siblings to `<IRS990>` inside `<ReturnData>`, not children of it:

```xml
<ReturnData>
  <IRS990>...</IRS990>
  <IRS990ScheduleL>
    <TransactionsRelatedOrgGrp>          <!-- repeating, up to 5 -->
      <NameOfInterested>...</NameOfInterested>
      <RelationshipWithOrganizationTxt>...</RelationshipWithOrganizationTxt>
      <Desc>...</Desc>
      <TransactionAmt>...</TransactionAmt>
    </TransactionsRelatedOrgGrp>
  </IRS990ScheduleL>
  <IRS990ScheduleR>
    <IdRelatedTaxExemptOrgGrp>           <!-- repeating -->
      <OrganizationName/BusinessNameLine1Txt>...</OrganizationName...>
      <EIN>...</EIN>
      <ExemptCodeSectionTxt>...</ExemptCodeSectionTxt>
      <PrimaryActivitiesTxt>...</PrimaryActivitiesTxt>
    </IdRelatedTaxExemptOrgGrp>
  </IRS990ScheduleR>
  <IRS990ScheduleO>
    <SupplementalInformationDetail>      <!-- repeating -->
      <FormAndLineReferenceDesc>...</FormAndLineReferenceDesc>
      <ExplanationTxt>...</ExplanationTxt>
    </SupplementalInformationDetail>
  </IRS990ScheduleO>
</ReturnData>
```

### Changes to `Parsed990` dataclass

```python
schedule_l_transactions: list[dict] = field(default_factory=list)
# [{party_name, relationship_description, transaction_description, amount}, ...]

schedule_r_orgs: list[dict] = field(default_factory=list)
# [{name, ein, org_type, description}, ...]

schedule_o_explanations: list[dict] = field(default_factory=list)
# [{form_line_reference, explanation_text}, ...]
```

### New function `_parse_schedules(return_data, result)`

Called at the end of `parse_990_xml()` after `_parse_990_full()` / `_parse_990ez()`.
Uses existing `_tag()`, `_text()`, `_int()` helpers — no new utilities needed.

```python
def _parse_schedules(return_data, result: Parsed990) -> None:
    """Parse Schedule L, R, and O from the ReturnData element."""
    # Schedule L — related-party transactions
    sched_l = return_data.find(_tag("IRS990ScheduleL"))
    if sched_l is not None:
        for grp in sched_l.findall(_tag("TransactionsRelatedOrgGrp")):
            result.schedule_l_transactions.append({
                "party_name":               _text(grp, "NameOfInterested"),
                "relationship_description": _text(grp, "RelationshipWithOrganizationTxt"),
                "transaction_description":  _text(grp, "Desc"),
                "amount":                   _int(grp, "TransactionAmt"),
            })

    # Schedule R — related organizations
    sched_r = return_data.find(_tag("IRS990ScheduleR"))
    if sched_r is not None:
        for grp in sched_r.findall(_tag("IdRelatedTaxExemptOrgGrp")):
            name_elem = grp.find(_tag("OrganizationName"))
            name = ""
            if name_elem is not None:
                name = _text(name_elem, "BusinessNameLine1Txt")
            result.schedule_r_orgs.append({
                "name":        name,
                "ein":         _text(grp, "EIN"),
                "org_type":    _text(grp, "ExemptCodeSectionTxt"),
                "description": _text(grp, "PrimaryActivitiesTxt"),
            })

    # Schedule O — supplemental explanations
    sched_o = return_data.find(_tag("IRS990ScheduleO"))
    if sched_o is not None:
        for detail in sched_o.findall(_tag("SupplementalInformationDetail")):
            result.schedule_o_explanations.append({
                "form_line_reference": _text(detail, "FormAndLineReferenceDesc"),
                "explanation_text":    _text(detail, "ExplanationTxt"),
            })
```

### Changes to `jobs.py` `run_irs_fetch_xml()`

After `FinancialSnapshot.objects.create(...)`:

```python
# Bulk-create Schedule L transaction rows
if parsed.schedule_l_transactions:
    ScheduleLTransaction.objects.bulk_create([
        ScheduleLTransaction(
            snapshot=fin,
            case=case,
            tax_year=tax_year,
            party_name=t["party_name"],
            relationship_description=t.get("relationship_description", ""),
            transaction_description=t.get("transaction_description", ""),
            amount=t.get("amount"),
        )
        for t in parsed.schedule_l_transactions
    ])

# Populate JSON schedule fields
fin.schedule_r_orgs = parsed.schedule_r_orgs
fin.schedule_o_explanations = parsed.schedule_o_explanations
fin.save(update_fields=["schedule_r_orgs", "schedule_o_explanations"])
```

---

## Signal Rule Upgrades (`signal_rules.py`)

### SR-025 — two new detection modes

**Mode 1: Contradiction mode** (IRS data vs. IRS data)

```
For each FinancialSnapshot where:
  - related_party_disclosed = False   (org told IRS "no related-party txns"; DB field)
  - AND ScheduleLTransaction rows exist for that snapshot with amount > 0

→ FIRE SR-025: evidence_snapshot includes party names, amounts, and tax year.
  Severity: CRITICAL (self-contradiction within IRS-filed documents)
```

**Mode 2: Network cross-reference mode** (IRS data vs. Catalyst Relationship model)

```
For each ScheduleLTransaction in the case:
  - Check if party_name fuzzy-matches any Person.full_name or Organization.name
    already in the case using difflib.SequenceMatcher ratio ≥ 0.80
    (same threshold as entity_resolution.py — following the existing pattern)
  - If match found → FIRE SR-025: evidence_snapshot includes matched entity ID,
    party name, relationship_description, transaction_description, and amount.
  Severity: CRITICAL
```

The existing OCR text-pattern check remains as a **fallback** for cases where XML data
has not been loaded (manually uploaded PDF 990s, older filings).

The three modes are additive — all three run; each fires independently if triggered.
Deduplication is handled by `persist_signals()` via the `(case, rule_id, trigger_entity_id)`
unique key (existing behavior).

### SR-028 — evidence enrichment only

SR-028 already fires correctly when `governance.material_diversion_or_misuse = True`.

**Change:** When the matching `FinancialSnapshot` has `schedule_o_explanations`, find the
entry whose `form_line_reference` contains `"Part VI"` or `"Line 5"` and attach its
`explanation_text` to `evidence_snapshot["schedule_o_explanation"]`. The referral PDF
then quotes the organization's own words verbatim.

No change to firing logic or severity.

### New rule SR-030 — Schedule L Disclosure Flag

```
Rule ID:   SR-030
Severity:  HIGH
Title:     Related-Party Transaction Disclosed on Schedule L
Charter:   One or more Schedule L transactions with amount > 0 exist for an
           organization in this case. Not necessarily fraudulent — but warrants
           review of whether the transaction was arm's-length and properly authorized.

Fires when:
  - ScheduleLTransaction rows exist for the case with amount > 0

Evidence snapshot includes:
  - party_name, relationship_description, transaction_description, amount
  - tax_year, org EIN
```

### New rule SR-031 — Zero Independent Board Members

```
Rule ID:   SR-031
Severity:  MEDIUM
Title:     No Independent Board Members at Material-Revenue Organization
Charter:   Form 990 Part VI reports zero independent voting members at an
           organization with total revenue exceeding $250,000. A board with
           no independent oversight is a governance red flag.

Fires when:
  - FinancialSnapshot.num_independent_members = 0
  - AND FinancialSnapshot.total_revenue > 250,000

Evidence snapshot includes:
  - num_independent_members, total_revenue, tax_year, org EIN
```

---

## Data Flow (end to end)

```
Investigator clicks "Fetch 990 Data"
  ↓
POST /api/cases/:id/research/irs/  →  SearchJob(IRS_FETCH_XML)  →  202
  ↓
run_irs_fetch_xml(job_id)  [Django-Q2 worker]
  ↓
fetch_990_xml()  →  raw XML
  ↓
parse_990_xml()
  ├── _parse_990_full()      →  Parsed990.financials / .governance / .officers  (existing)
  └── _parse_schedules()     →  Parsed990.schedule_l_transactions               (NEW)
                                Parsed990.schedule_r_orgs                        (NEW)
                                Parsed990.schedule_o_explanations                (NEW)
  ↓
FinancialSnapshot.objects.create()  (existing)
  └── ScheduleLTransaction.objects.bulk_create()                                 (NEW)
      snapshot.schedule_r_orgs = [...]                                           (NEW)
      snapshot.schedule_o_explanations = [...]                                   (NEW)
  ↓
signal_rules.evaluate_xml_financial_snapshots()  (existing call in jobs.py)
  ├── SR-025 OCR mode          (existing — unchanged)
  ├── SR-025 contradiction     →  FIRE if schedule_l_required=False + txns exist (NEW)
  ├── SR-025 network mode      →  FIRE if party matches Relationship model        (NEW)
  ├── SR-028 enrichment        →  evidence_snapshot gains Schedule O text         (NEW)
  ├── SR-030                   →  FIRE if Schedule L txns with amount > 0         (NEW)
  └── SR-031                   →  FIRE if independent_members=0 + revenue>$250K  (NEW)
  ↓
AuditLog entries  (existing)
  ↓
Frontend polls GET /api/jobs/:id/  →  SUCCESS
Case Angles tab shows new findings
```

No new endpoints. No frontend changes required.

---

## Files Modified

| File | Change |
|------|--------|
| `backend/investigations/models.py` | Add `ScheduleLTransaction` model; add `schedule_r_orgs` and `schedule_o_explanations` JSONFields to `FinancialSnapshot` |
| `backend/investigations/migrations/0033_*.py` | Generated migration |
| `backend/investigations/irs_connector.py` | Add `schedule_l_transactions`, `schedule_r_orgs`, `schedule_o_explanations` to `Parsed990`; add `_parse_schedules()`; call it from `parse_990_xml()` |
| `backend/investigations/jobs.py` | After `FinancialSnapshot.objects.create()`, bulk-create `ScheduleLTransaction` rows and save JSON fields |
| `backend/investigations/signal_rules.py` | Upgrade SR-025 (two new modes); upgrade SR-028 (evidence enrichment); add SR-030 and SR-031 to `RULE_REGISTRY` and implement evaluators |
| `backend/investigations/serializers.py` | Add `schedule_l_transactions` to `FinancialSnapshot` serializer output if it exists |
| `docs/architecture/api-contract.md` | Document new fields on `FinancialSnapshot` response shape |

---

## Not In Scope

- Entity resolution linking Schedule L party names to `Person`/`Organization` records
  (deferred — Approach B)
- Schedule D (supplemental financial statements) parsing
- Subsystems B–E (UCC burst, parcel signals, audit signals, deed authorization) — each
  gets its own spec in sequence
