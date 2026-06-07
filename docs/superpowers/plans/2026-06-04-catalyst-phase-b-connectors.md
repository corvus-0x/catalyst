# Phase B — Connectors: Verify + Green (Deep Sub-Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live-verify all five Catalyst connectors, then make every connector test module green — by **rewriting** the dead `test_irs.py` against the current 990-XML connector, fixing two stale connector tests at the right layer, and deleting the superseded ProPublica connector.

**Architecture:** Verify-first, then green. B1 live-verifies the connectors against real sources so we can honestly classify each red test as *stale* (drifted from working code) vs *real regression* — that ordering is load-bearing. Then each test module is fixed root-cause-first, run green locally, and committed independently (green-before-push, module-by-module). Connector **logic is never rewritten**; only tests change, plus the deletion of dead code.

**Tech Stack:** Django 4.2 `manage.py test` on native PG18 (`127.0.0.1:5433`, trust auth, local). Connector tests are pure `unittest` (HTTP mocked) — no DB needed, but the suite runs through `manage.py test` so Django is configured.

---

## Why this sub-plan exists (what the audit got wrong)

The parent fix-pass plan (`2026-06-03-catalyst-fix-pass.md`, Phase B, tasks B1–B4) was written from the audit's *sampled* view. Grounding each task in the real code on 2026-06-04 surfaced three corrections the executor MUST know:

1. **`test_irs.py` is not a one-line import fix — it is a wholesale-dead file.** All **104** test methods test the removed **Pub78 / EO-BMF bulk-CSV** subsystem. The connector was rewritten to a **990-XML-index streaming** design (`search_990_by_name`, `parse_990_xml`, `IndexRecord`, `Parsed990`, …). Only `IRSError` survived, and even it changed (no more `status_code`/`ein` attributes). **Owner decision (Tyler, 2026-06-04): rewrite** `test_irs.py` to unit-test the new XML connector. **Verified current coverage of the new connector (2026-06-04):** only `parse_990_xml` is genuinely exercised — by `test_schedule_lro.py`, which calls the real parser for Schedule L/R/O. The other three files **mock the connector away**: `test_jobs.py` patches the whole `irs_connector` module, `test_integration_qcluster.py` and `test_signals.py` stub `search_990_by_*`/`fetch_990_xml`/`parse_990_xml`. The **fetch/index layer** (`_stream_search_index` CSV parsing, `fetch_990_xml`, `_fetch_zip_directory` — ZIP central-directory + HTTP range, ~290 lines) has **zero real coverage anywhere**. **Owner decision (Tyler, 2026-06-04): cover the fetch/ZIP layer now** (Task B2.7) — see the **Coverage boundary** note in Task B2 for what's covered vs the residual acceptable gaps.

2. **`test_ohio_aos` fails for a different reason than "fixture drift."** The fixture (`MOCK_HTML`) is already a correct 2-row table. The real bug: the test patches `investigations.ohio_aos_connector.requests.get`, but the connector was refactored to use `requests.Session()` — it calls `session.get` / `session.post`, which the patch never intercepts. So the test fired **real HTTP requests at ohioauditor.gov** (`11545 != 2` from the live page; "AOSError not raised" from a live 200). The parser is **regex-based, not BeautifulSoup**. Fix = patch `requests.Session` and supply a GET page carrying `__VIEWSTATE` (the connector aborts without it).

3. **`propublica_connector.py` is confirmed dead** — no non-test module imports it (every other `ProPublica` hit is a comment/docstring/string literal; `FinancialSnapshot.source="PROPUBLICA"` is just a historical enum string). **Owner decision (Tyler, 2026-06-04): delete** both `propublica_connector.py` and `test_propublica.py`.

---

## Conventions (read first — inherited from the parent plan)

- **Parent plan:** `docs/superpowers/plans/2026-06-03-catalyst-fix-pass.md` (Phase B). **Spec:** `docs/superpowers/specs/2026-06-03-catalyst-fix-pass-design.md`. **Audit:** `docs/architecture/audit-2026-06-03.md`.
- **Branch:** `fix/audit-punch-list` (already checked out). **Tyler commits** from his local machine (sandbox git hook issue) — each task ends at a commit checkpoint Tyler performs. The agent reaches the checkpoint and reports the exact `git add` / message.
- **The core test loop** (from repo root, Bash tool / git-bash):
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.<module> -v 2 --keepdb
  ```
  Connector tests need no DB, but `--keepdb` keeps the run fast. Drop `--keepdb` only after a model/migration change (none in this plan).
- **The classification rule (apply to EVERY red test):** run it → read the failure → classify:
  1. **Stale test** — asserts an outdated value against working code → **update the test** to the current contract.
  2. **Real bug** — the assertion is correct, the code violates it → **fix the code** if small (≤ a few lines); if it balloons, mark `@unittest.expectedFailure` with a `# AUDIT-DEFER:` reason + add an audit §3 entry, and move on.
  3. **Dead code** — delete it.
  - **Never edit an assertion just to make it pass.** Read the code under test before deciding.
- **Tests-for-working-code caveat (B2):** the XML connector already works, so newly-written tests should pass on first run — they *characterize* existing behavior. A red new test means *the test is wrong* or *a real connector bug exists* (classify per the rule) — it is **not** license to change connector logic to satisfy a test.
- **Definition of green:** the targeted module(s) report 0 failures/0 errors; only documented `skip`/`expectedFailure` remain.

---

## File structure (what this sub-plan touches)

| File | Change |
|------|--------|
| `backend/investigations/tests/test_irs.py` | **Rewrite** — replace 104 dead Pub78/EO-BMF tests with unit tests for the 990-XML connector (B2) |
| `backend/investigations/tests/test_county_auditor.py` | One-line assertion fix: `odnr_landbase_v2` → `odnr_landbase` (B3a) |
| `backend/investigations/tests/test_ohio_aos.py` | Fix mock target (`requests.Session`) + add `__VIEWSTATE` GET page (B3b) |
| `backend/investigations/propublica_connector.py` | **Delete** (B4) |
| `backend/investigations/tests/test_propublica.py` | **Delete** (B4) |
| `docs/architecture/audit-2026-06-03.md` | Record B1 live-verify results + the rewrite/delete outcomes (B5) |
| *connector source files* | **No logic changes** — verification + tests only |

---

## Task B1: Live-verify the five connectors (verification only — NO commit)

**Files:** none. Network-dependent; record status and move on. Do this **first** — it licenses the "stale" classification in B2/B3.

Run each via the Django shell so settings are loaded. Prefix every command with the env loader:
```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py shell -c "<snippet>"
```

- [ ] **Step 1: IRS TEOS XML** — known-good name search (audit/STATUS reference: "bright future" returns many filings across years; scoped to one year here to bound runtime).
  ```python
  from investigations.irs_connector import search_990_by_name
  r = search_990_by_name("bright future", years=[2024])
  print("IRS:", len(r), "filings;", r[0].taxpayer_name if r else "(none)")
  ```
  Expected: ≥1 filing printed (network-dependent). Record **works / fails + detail**.

- [ ] **Step 2: County Recorder** — exercise the 88-county portal map (URL builder; no live fetch needed).
  ```python
  from investigations.county_recorder_connector import list_counties, get_county_info
  from investigations.county_recorder_connector import OhioCounty
  cs = list_counties()
  info = get_county_info(list(OhioCounty)[0])
  print("Recorder:", len(cs), "counties; sample:", info)
  ```
  Expected: 88 counties; a populated `CountyInfo`. Record status.

- [ ] **Step 3: Ohio AOS** — live ASP.NET audit-report search.
  ```python
  from investigations.ohio_aos_connector import search_audit_reports
  try:
      r = search_audit_reports("Columbus")
      print("AOS:", len(r), "reports")
  except Exception as e:
      print("AOS FAILED:", type(e).__name__, e)
  ```
  Expected: a count (or a clean `AOSError` if the page structure/network is down). Record status.

- [ ] **Step 4: Ohio SOS** — manual-CSV path. Report whether a local CSV is present.
  ```python
  from investigations.ohio_sos_connector import get_local_file_status
  print("SOS local files:", get_local_file_status())
  ```
  Expected: a list (empty if no CSV uploaded yet — that's the documented manual step, not a failure). Record status; note "requires manual CSV upload via `POST /api/admin/upload-sos-csv/`".

- [ ] **Step 5: County Auditor (ODNR)** — attempt a parcel search. **Expected: fail (ODNR ArcGIS 404, upstream).**
  ```python
  from investigations.county_auditor_connector import search_parcels_by_owner
  try:
      r = search_parcels_by_owner("SMITH")
      print("Auditor:", len(r), "parcels")
  except Exception as e:
      print("Auditor FAILED (expected):", type(e).__name__, e)
  ```
  Expected: `AuditorError` / 404. Record as **known-down (upstream), not a regression** — note the connector now also has a fallback URL (`ODNR_PARCEL_QUERY_URL_FALLBACK`).

- [ ] **Step 6: Write the live-verify results table** into the audit (§1.4 / §3) as "connector → live status, 2026-06-04". No code commit (this is captured in B5's docs commit).

---

## Task B2: Rewrite `test_irs.py` for the 990-XML connector

**Files:**
- Rewrite: `backend/investigations/tests/test_irs.py` (replace entire file)
- Code under test (read-only): `backend/investigations/irs_connector.py`

The new file is pure `unittest` (no Django, no network). The network boundary for search is `_stream_search_index` — mock **that**, not `requests`. `parse_990_xml` is pure (string in, dataclass out) — no mock needed.

> **Coverage boundary (RESOLVED — Tyler chose Option 2, 2026-06-04).** Steps 1–6 cover the **pure/orchestration layer**: `parse_990_xml` (header, Part I financials, governance, Schedule L auto-flag, edge cases), the `search_990_by_*` **dedup/sort/filter** logic (with `_stream_search_index` mocked), and `parsed_990_to_dict`/`filing_to_dict`/`clear_caches`. **Task B2.7** (Steps 7–10) then covers the **fetch/index layer** — `_stream_search_index` (CSV streaming), `fetch_990_xml`, `_fetch_zip_directory` (ZIP central-directory + HTTP range) — with byte-level fixtures. **Residual gaps (acceptable, recorded in B5):** the 990EZ/990PF variant parsers, Part VII officer parsing, and `_fetch_990_xml_full_zip` (the DEFLATE64 → system `unzip` fallback). Schedule R/O parsing is already covered by `test_schedule_lro`.

- [ ] **Step 1: Replace the file header + pure-unit tests** (errors, `_normalize_ein`, `IndexRecord` properties, XML scalar helpers).

  Overwrite `backend/investigations/tests/test_irs.py` with:

  ```python
  """
  Tests for irs_connector.py (990-XML-index design).

  Pure unittest — no Django, no network. The connector fetches the IRS yearly
  index via _stream_search_index(); search tests mock THAT seam (not requests),
  because that is the real network boundary. parse_990_xml() is pure (XML string
  in, Parsed990 out) and needs no mock.

  Replaces the previous Pub78/EO-BMF bulk-CSV test suite, which tested a
  subsystem removed when the connector moved to 990-XML streaming.
  """

  import io
  import re
  import unittest
  import zipfile
  from unittest.mock import MagicMock, patch

  from investigations.irs_connector import (
      IndexRecord,
      IRSError,
      IRSNetworkError,
      IRSNotFoundError,
      IRSParseError,
      _bool,
      _fetch_zip_directory,
      _int,
      _normalize_ein,
      _stream_search_index,
      _text,
      clear_caches,
      fetch_990_xml,
      filing_to_dict,
      parse_990_xml,
      parsed_990_to_dict,
      search_990_by_ein,
      search_990_by_name,
  )
  # io/re/zipfile/MagicMock + _fetch_zip_directory/_stream_search_index/fetch_990_xml
  # are used by the fetch/index-layer tests added in Task B2.7.


  # --- shared fixtures -------------------------------------------------------

  def _idx(
      object_id,
      *,
      tax_period="202112",
      return_type="990",
      sub_date="2022",
      ein="123456789",
      name="EXAMPLE ORG",
  ):
      """Build an IndexRecord with sensible defaults for search tests."""
      return IndexRecord(
          return_id="R" + object_id,
          filing_type="EFILE",
          ein=ein,
          tax_period=tax_period,
          sub_date=sub_date,
          taxpayer_name=name,
          return_type=return_type,
          dln="DLN" + object_id,
          object_id=object_id,
          xml_batch_id="2022_TEOS_XML_01A",
          index_year=int(tax_period[:4]),
      )


  class ErrorClassTests(unittest.TestCase):
      def test_subclass_hierarchy(self):
          for sub in (IRSNetworkError, IRSParseError, IRSNotFoundError):
              self.assertTrue(issubclass(sub, IRSError))

      def test_message_roundtrip(self):
          self.assertEqual(str(IRSError("boom")), "boom")


  class NormalizeEinTests(unittest.TestCase):
      def test_strips_dash_and_pads(self):
          self.assertEqual(_normalize_ein("12-3456789"), "123456789")

      def test_zero_pads_short(self):
          self.assertEqual(_normalize_ein("123"), "000000123")

      def test_strips_spaces(self):
          self.assertEqual(_normalize_ein(" 12 3456789 "), "123456789")


  class IndexRecordPropertyTests(unittest.TestCase):
      def test_tax_year_from_period(self):
          self.assertEqual(_idx("A", tax_period="202012").tax_year, 2020)

      def test_tax_year_bad_period_is_zero(self):
          self.assertEqual(_idx("A", tax_period="").tax_year, 0)

      def test_ein_formatted(self):
          self.assertEqual(_idx("A", ein="123456789").ein_formatted, "12-3456789")

      def test_zip_url_and_xml_filename(self):
          rec = _idx("OBJ123")
          self.assertTrue(rec.zip_url.endswith("/2022/2022_TEOS_XML_01A.zip"))
          self.assertEqual(rec.xml_filename, "OBJ123_public.xml")


  class XmlHelperTests(unittest.TestCase):
      def test_text_int_bool(self):
          import xml.etree.ElementTree as ET
          ns = "http://www.irs.gov/efile"
          root = ET.fromstring(
              f'<R xmlns="{ns}">'
              "<Name>Acme</Name><Amt>1234.00</Amt><Flag>true</Flag>"
              "</R>"
          )
          self.assertEqual(_text(root, "Name"), "Acme")
          self.assertEqual(_int(root, "Amt"), 1234)   # handles decimal text
          self.assertIs(_bool(root, "Flag"), True)
          self.assertIsNone(_int(root, "Missing"))
          self.assertIsNone(_bool(root, "Missing"))
  ```

- [ ] **Step 2: Run the pure-unit tests** (file now imports cleanly — the old `ImportError: cannot import name 'EoBmfRecord'` is gone).
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_irs -v 2 --keepdb 2>&1 | tail -20
  ```
  Expected: the four classes above PASS (module imports; ~12 tests green).

- [ ] **Step 3: Append the `parse_990_xml` happy-path + edge-case tests.** Add to `test_irs.py`:

  ```python
  # --- parse_990_xml --------------------------------------------------------

  SAMPLE_990 = """<?xml version="1.0" encoding="UTF-8"?>
  <Return xmlns="http://www.irs.gov/efile" returnVersion="2022v5.0">
    <ReturnHeader>
      <TaxPeriodEndDt>2022-12-31</TaxPeriodEndDt>
      <TaxPeriodBeginDt>2022-01-01</TaxPeriodBeginDt>
      <ReturnTypeCd>990</ReturnTypeCd>
      <TaxYr>2022</TaxYr>
      <Filer>
        <EIN>123456789</EIN>
        <BusinessName>
          <BusinessNameLine1Txt>Bright Future Foundation</BusinessNameLine1Txt>
        </BusinessName>
      </Filer>
    </ReturnHeader>
    <ReturnData>
      <IRS990>
        <FormationYr>2001</FormationYr>
        <LegalDomicileStateCd>OH</LegalDomicileStateCd>
        <ActivityOrMissionDesc>Bright future in the community.</ActivityOrMissionDesc>
        <WebsiteAddressTxt>www.example.org</WebsiteAddressTxt>
        <CYContributionsGrantsAmt>1000000</CYContributionsGrantsAmt>
        <CYTotalRevenueAmt>5000000</CYTotalRevenueAmt>
        <CYTotalExpensesAmt>4500000</CYTotalExpensesAmt>
        <TotalEmployeeCnt>42</TotalEmployeeCnt>
        <ScheduleBRequiredInd>true</ScheduleBRequiredInd>
      </IRS990>
    </ReturnData>
  </Return>
  """

  SAMPLE_990_WITH_SCHED_L = """<?xml version="1.0" encoding="UTF-8"?>
  <Return xmlns="http://www.irs.gov/efile">
    <ReturnHeader>
      <ReturnTypeCd>990</ReturnTypeCd><TaxYr>2022</TaxYr>
      <Filer><EIN>123456789</EIN>
        <BusinessName><BusinessNameLine1Txt>Insider Org</BusinessNameLine1Txt></BusinessName>
      </Filer>
    </ReturnHeader>
    <ReturnData>
      <IRS990><LegalDomicileStateCd>OH</LegalDomicileStateCd></IRS990>
      <IRS990ScheduleL>
        <TransactionsRelatedOrgGrp>
          <NameOfInterested>John Insider</NameOfInterested>
          <RelationshipWithOrganizationTxt>Board chair</RelationshipWithOrganizationTxt>
          <Desc>Consulting contract</Desc>
          <TransactionAmt>50000</TransactionAmt>
        </TransactionsRelatedOrgGrp>
      </IRS990ScheduleL>
    </ReturnData>
  </Return>
  """


  class Parse990HappyPathTests(unittest.TestCase):
      def setUp(self):
          self.parsed = parse_990_xml(SAMPLE_990, source_object_id="OBJ1", source_batch_id="B1")

      def test_header_fields(self):
          p = self.parsed
          self.assertEqual(p.ein, "123456789")
          self.assertEqual(p.taxpayer_name, "Bright Future Foundation")
          self.assertEqual(p.tax_year, 2022)
          self.assertEqual(p.return_type, "990")
          self.assertEqual(p.tax_period_end, "2022-12-31")
          self.assertEqual(p.state, "OH")
          self.assertIn("Bright future", p.mission)
          self.assertEqual(p.website, "www.example.org")

      def test_financials(self):
          f = self.parsed.financials
          self.assertEqual(f.total_contributions, 1000000)
          self.assertEqual(f.total_revenue, 5000000)
          self.assertEqual(f.total_expenses, 4500000)

      def test_governance_and_counts(self):
          self.assertIs(self.parsed.governance.schedule_b_required, True)
          self.assertEqual(self.parsed.num_employees, 42)

      def test_quality_and_provenance(self):
          self.assertEqual(self.parsed.parse_quality, 1.0)
          self.assertEqual(self.parsed.source_object_id, "OBJ1")
          self.assertEqual(self.parsed.source_batch_id, "B1")


  class Parse990ScheduleLTests(unittest.TestCase):
      def test_schedule_l_transaction_and_autoflag(self):
          p = parse_990_xml(SAMPLE_990_WITH_SCHED_L)
          self.assertEqual(len(p.schedule_l_transactions), 1)
          txn = p.schedule_l_transactions[0]
          self.assertEqual(txn["party_name"], "John Insider")
          self.assertEqual(txn["amount"], 50000)
          # Presence of Schedule L transactions forces schedule_l_required True
          self.assertIs(p.governance.schedule_l_required, True)


  class Parse990EdgeCaseTests(unittest.TestCase):
      def test_invalid_xml_raises(self):
          with self.assertRaises(IRSParseError):
              parse_990_xml("this is not xml")

      def test_no_return_data_quality_zero(self):
          xml = '<Return xmlns="http://www.irs.gov/efile"><ReturnHeader/></Return>'
          self.assertEqual(parse_990_xml(xml).parse_quality, 0.0)

      def test_unknown_form_quality_low(self):
          xml = (
              '<Return xmlns="http://www.irs.gov/efile">'
              "<ReturnData><IRS990XYZ/></ReturnData></Return>"
          )
          self.assertEqual(parse_990_xml(xml).parse_quality, 0.1)
  ```

- [ ] **Step 4: Run again** — the parse tests should pass on first run (they characterize the existing parser).
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_irs -v 2 --keepdb 2>&1 | tail -25
  ```
  Expected: all parse tests PASS. If one is red, apply the classification rule — do **not** edit the connector to fit a test without confirming the test is correct against the connector source.

- [ ] **Step 5: Append the search + serialization tests.** Add to `test_irs.py`:

  ```python
  # --- search (mock the _stream_search_index network seam) ------------------

  @patch("investigations.irs_connector.time.sleep")  # skip POLITE_DELAY
  @patch("investigations.irs_connector._stream_search_index")
  class SearchByEinTests(unittest.TestCase):
      def test_dedupes_by_object_id_across_years(self, mock_stream, _sleep):
          # year 2024 -> A,B ; year 2023 -> B again -> deduped to 2
          mock_stream.side_effect = [[_idx("A"), _idx("B")], [_idx("B")]]
          result = search_990_by_ein("12-3456789", years=[2024, 2023])
          self.assertEqual(result.total_found, 2)
          self.assertEqual(result.ein_formatted, "12-3456789")

      def test_sorts_by_tax_year_desc(self, mock_stream, _sleep):
          mock_stream.side_effect = [
              [_idx("OLD", tax_period="202012"), _idx("NEW", tax_period="202212")]
          ]
          result = search_990_by_ein("123456789", years=[2024])
          self.assertEqual(result.filings[0].object_id, "NEW")

      def test_return_types_filter(self, mock_stream, _sleep):
          mock_stream.side_effect = [
              [_idx("A", return_type="990"), _idx("B", return_type="990EZ")]
          ]
          result = search_990_by_ein("123456789", years=[2024], return_types=["990"])
          self.assertEqual(result.total_found, 1)
          self.assertEqual(result.filings[0].object_id, "A")


  @patch("investigations.irs_connector.time.sleep")
  @patch("investigations.irs_connector._stream_search_index")
  class SearchByNameTests(unittest.TestCase):
      def test_passes_uppercased_name_filter(self, mock_stream, _sleep):
          mock_stream.side_effect = [[_idx("A", name="BRIGHT FUTURE INC")]]
          results = search_990_by_name("bright future", years=[2024])
          self.assertEqual(len(results), 1)
          # connector uppercases the query before delegating
          self.assertEqual(mock_stream.call_args.kwargs["name_filter"], "BRIGHT FUTURE")


  # --- serialization + cache ------------------------------------------------

  class SerializationTests(unittest.TestCase):
      def test_parsed_990_to_dict(self):
          d = parsed_990_to_dict(parse_990_xml(SAMPLE_990))
          self.assertEqual(d["source"], "IRS_TEOS_XML")
          self.assertEqual(d["ein"], "123456789")
          self.assertEqual(d["ein_formatted"], "12-3456789")
          self.assertEqual(d["taxpayer_name"], "Bright Future Foundation")
          self.assertEqual(d["financials"]["total_revenue"], 5000000)

      def test_filing_to_dict(self):
          d = filing_to_dict(_idx("OBJ9", tax_period="202112"))
          self.assertEqual(d["ein"], "12-3456789")
          self.assertEqual(d["object_id"], "OBJ9")
          self.assertEqual(d["tax_year"], 2021)
          self.assertEqual(d["return_type"], "990")


  class CacheTests(unittest.TestCase):
      def test_clear_caches_runs_clean(self):
          self.assertIsNone(clear_caches())


  if __name__ == "__main__":
      unittest.main()
  ```

- [ ] **Step 6: Run the full module green.**
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_irs -v 2 --keepdb 2>&1 | tail -30
  ```
  Expected: `OK` — all classes pass, 0 failures/errors. (`search_990_by_name`'s `state` arg is documented "ignored" — do not test it.)

### Task B2.7: Fetch/index-layer tests (ZIP central directory + CSV streaming)

**Files:** Append to `backend/investigations/tests/test_irs.py` (same file, same commit as B2).

Per Tyler's 2026-06-04 decision (Option 2), cover the connector's network-heavy half with byte-level fixtures: a real in-memory ZIP served through a Range-aware fake, and a streamed CSV index. **Excluded (deliberate):** `_fetch_990_xml_full_zip` — the DEFLATE64 fallback shells out to the system `unzip` binary (platform-dependent; not worth a fixture). Record that exclusion as a one-line audit note in B5.

- [ ] **Step 7: Append the fetch/index-layer tests.** Add to `test_irs.py`:

  ```python
  # --- fetch / index layer (CSV streaming + ZIP central directory) ----------
  # Exercises the connector's network half end-to-end with byte-level fixtures.
  # _stream_search_index streams a CSV; the ZIP tests build a REAL in-memory ZIP
  # (zipfile guarantees a valid central directory) and serve byte ranges from it.
  # NOT covered: _fetch_990_xml_full_zip (DEFLATE64 -> system `unzip`, platform-
  # dependent; see audit punch-list).

  _INDEX_CSV = (
      "RETURN_ID,FILING_TYPE,EIN,TAX_PERIOD,SUB_DATE,TAXPAYER_NAME,"
      "RETURN_TYPE,DLN,OBJECT_ID,XML_BATCH_ID\n"
      "1,EFILE,123456789,202112,2022,GOOD WORKS INC,990,DLN1,OBJ1,2022_TEOS_XML_01A\n"
      "2,EFILE,987654321,202012,2021,HELPING HANDS INC,990,DLN2,OBJ2,2021_TEOS_XML_01A\n"
      "3,EFILE,111222333,202112,2022,UNRELATED LLC,990EZ,DLN3,OBJ3,2022_TEOS_XML_01A\n"
  )  # trailing "\n" is REQUIRED: the streamer never flushes its final line buffer


  def _streaming_csv_response(csv_text):
      resp = MagicMock()
      resp.raise_for_status.return_value = None
      resp.iter_content.return_value = [csv_text]  # one decoded chunk
      return resp


  def _make_zip(filename="OBJ1_public.xml", content="<Return>hello world</Return>" * 20):
      buf = io.BytesIO()
      with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
          zf.writestr(filename, content)
      return buf.getvalue(), content


  def _range_aware_zip(zip_bytes):
      """Return (fake_head, fake_get) that serve byte ranges from an in-memory ZIP."""
      def fake_head(url, **kw):
          r = MagicMock()
          r.raise_for_status.return_value = None
          r.headers = {"content-length": str(len(zip_bytes))}
          return r

      def fake_get(url, headers=None, **kw):
          r = MagicMock()
          r.raise_for_status.return_value = None
          rng = (headers or {}).get("Range", "")
          m = re.match(r"bytes=(\d+)-(\d+)", rng)
          r.content = zip_bytes[int(m.group(1)) : int(m.group(2)) + 1] if m else zip_bytes
          return r

      return fake_head, fake_get


  @patch("investigations.irs_connector.requests.get")
  class StreamSearchIndexTests(unittest.TestCase):
      def test_filters_by_ein(self, mock_get):
          mock_get.return_value = _streaming_csv_response(_INDEX_CSV)
          recs = _stream_search_index(2022, ein_filter="123456789")
          self.assertEqual(len(recs), 1)
          self.assertEqual(recs[0].taxpayer_name, "GOOD WORKS INC")
          self.assertEqual(recs[0].index_year, 2022)

      def test_filters_by_name(self, mock_get):
          mock_get.return_value = _streaming_csv_response(_INDEX_CSV)
          recs = _stream_search_index(2022, name_filter="INC")  # caller passes upper
          self.assertEqual({r.object_id for r in recs}, {"OBJ1", "OBJ2"})

      def test_respects_max_results(self, mock_get):
          mock_get.return_value = _streaming_csv_response(_INDEX_CSV)
          recs = _stream_search_index(2022, name_filter="INC", max_results=1)
          self.assertEqual(len(recs), 1)

      def test_no_match_returns_empty(self, mock_get):
          mock_get.return_value = _streaming_csv_response(_INDEX_CSV)
          self.assertEqual(_stream_search_index(2022, ein_filter="000000000"), [])


  @patch("investigations.irs_connector.time.sleep")
  class ZipFetchTests(unittest.TestCase):
      def setUp(self):
          clear_caches()  # _fetch_zip_directory caches by URL

      def test_fetch_zip_directory_parses_entries(self, _sleep):
          zip_bytes, _ = _make_zip("OBJ1_public.xml")
          fake_head, fake_get = _range_aware_zip(zip_bytes)
          with (
              patch("investigations.irs_connector.requests.head", side_effect=fake_head),
              patch("investigations.irs_connector.requests.get", side_effect=fake_get),
          ):
              directory = _fetch_zip_directory("https://example.test/batch.zip")
          self.assertIn("OBJ1_public.xml", directory.entries)
          entry = directory.entries["OBJ1_public.xml"]
          self.assertEqual(entry.compression_method, 8)  # DEFLATE
          self.assertGreater(entry.uncompressed_size, 0)

      def test_fetch_990_xml_roundtrips_through_deflate(self, _sleep):
          zip_bytes, content = _make_zip("OBJ1_public.xml")
          fake_head, fake_get = _range_aware_zip(zip_bytes)
          with (
              patch("investigations.irs_connector.requests.head", side_effect=fake_head),
              patch("investigations.irs_connector.requests.get", side_effect=fake_get),
          ):
              xml = fetch_990_xml(_idx("OBJ1"))  # xml_filename -> OBJ1_public.xml
          self.assertEqual(xml, content)

      def test_fetch_990_xml_missing_file_raises(self, _sleep):
          zip_bytes, _ = _make_zip("OTHER_public.xml")
          fake_head, fake_get = _range_aware_zip(zip_bytes)
          with (
              patch("investigations.irs_connector.requests.head", side_effect=fake_head),
              patch("investigations.irs_connector.requests.get", side_effect=fake_get),
          ):
              with self.assertRaises(IRSNotFoundError):
                  fetch_990_xml(_idx("OBJ1"))  # looks for OBJ1_public.xml, absent
  ```

  Move the `if __name__ == "__main__": unittest.main()` block (from B2 Step 5) to the very end of the file if it isn't already last.

- [ ] **Step 8: Run the full module green** (all classes — parse, search, serialization, fetch/index).
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_irs -v 2 --keepdb 2>&1 | tail -35
  ```
  Expected: `OK`. The `*_roundtrips_through_deflate` test proves the ZIP fetch path works end-to-end: build ZIP → Range-fetch bytes → parse central directory → inflate → original XML. If it fails on byte offsets, re-read `_fetch_990_xml_ranged` (it over-reads `30 + 300 + compressed_size` from `local_header_offset` and parses `fname_len`/`extra_len` from the local header) before adjusting the fixture — the connector logic is correct; the fake must serve what it asks for.

- [ ] **Step 9: Lint the rewritten file** (the pre-commit hook runs ruff; do it now so the commit is clean).
  ```bash
  ./.venv/Scripts/python.exe -m ruff check --fix backend/investigations/tests/test_irs.py \
    && ./.venv/Scripts/python.exe -m ruff format backend/investigations/tests/test_irs.py
  ```
  Expected: "All checks passed" + formatted. Re-run Step 8 if ruff reordered anything material.

- [ ] **Step 10: Commit** (Tyler):
  ```bash
  git add backend/investigations/tests/test_irs.py
  git commit -m "test(irs): rewrite test_irs for 990-XML connector (parse + search + fetch/ZIP layer)"
  ```

---

## Task B3a: Fix the stale `test_county_auditor` ODNR URL assertion

**Files:** Modify `backend/investigations/tests/test_county_auditor.py:579`

The connector builds `.../OIT_Services/odnr_landbase/MapServer/4/query` (source comment line 92-95: *"Updated 2026-04-13: ...odnr_landbase_v2 → odnr_landbase"*). The test still asserts the old `odnr_landbase_v2`. **Stale test — connector is correct.**

- [ ] **Step 1: See the failure.**
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_county_auditor.CountyAuditorTests.test_query_url_is_odnr -v 2 --keepdb 2>&1 | tail -15
  ```
  Expected: `AssertionError: 'odnr_landbase_v2' not found in '...odnr_landbase/MapServer/4/query'`.

- [ ] **Step 2: Update the assertion** at `test_county_auditor.py:579` — change:
  ```python
          self.assertIn("odnr_landbase_v2", call_url)
  ```
  to:
  ```python
          self.assertIn("/odnr_landbase/", call_url)
  ```
  (Slash-delimited on purpose: `/odnr_landbase/` matches the current path `.../OIT_Services/odnr_landbase/MapServer/4/query` but **not** the old `odnr_landbase_v2/`, so a regression to the dead URL would still fail the test. The mocked session returns success on the primary URL, so `call_args` is the primary — not the fallback.)

- [ ] **Step 3: Run the whole module green** (catch any sibling drift).
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_county_auditor -v 1 --keepdb 2>&1 | tail -12
  ```
  Expected: `OK`.

- [ ] **Step 4: Commit** (Tyler):
  ```bash
  git add backend/investigations/tests/test_county_auditor.py
  git commit -m "test(county_auditor): update stale ODNR URL assertion to odnr_landbase"
  ```

---

## Task B3b: Fix `test_ohio_aos` mock target (it was firing real HTTP)

**Files:** Modify `backend/investigations/tests/test_ohio_aos.py`

The connector uses `requests.Session()` (`session.get` for the ViewState page, then `session.post` for results), but the test patches `requests.get` — never called. So the test hit ohioauditor.gov live (`11545 != 2`; "AOSError not raised"). **Stale test — connector is correct.** Fix: patch `requests.Session`; give the GET a page containing `__VIEWSTATE` (the connector raises `AOSError` without it); give the POST the results table.

- [ ] **Step 1: Confirm the wrong-target failure.**
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_ohio_aos -v 2 --keepdb 2>&1 | tail -20
  ```
  Expected (network-dependent): `test_search_audit_reports_success` count mismatch and/or `test_search_audit_reports_http_error` "AOSError not raised". (If offline, the GET itself errors — also confirms the mock isn't intercepting.)

- [ ] **Step 2: Replace the whole file** `backend/investigations/tests/test_ohio_aos.py` with:

  ```python
  """
  Tests for the Ohio Auditor of State connector.

  The connector performs a two-step ASP.NET postback using requests.Session():
      1. GET search.aspx  -> extract __VIEWSTATE (aborts with AOSError if absent)
      2. POST search.aspx -> parse the results table
  So we patch requests.Session (NOT requests.get): session.get returns the
  ViewState-bearing page, session.post returns the results HTML.
  """

  import unittest
  from datetime import date
  from unittest.mock import MagicMock, patch

  from investigations.ohio_aos_connector import AOSError, search_audit_reports

  # GET response: the search page carrying ASP.NET hidden fields. __VIEWSTATE is
  # mandatory — the connector raises AOSError if it cannot extract it.
  VIEWSTATE_PAGE = """
  <html><body><form>
    <input type="hidden" name="__VIEWSTATE" value="dDwxMjM0NTY3ODk7Oz4=" />
    <input type="hidden" name="__VIEWSTATEGENERATOR" value="CA0B0334" />
    <input type="hidden" name="__EVENTVALIDATION" value="abcdEFGH1234" />
    <input type="text" name="txtQueryString" />
  </form></body></html>
  """

  # POST response: the results table the regex parser scrapes (header row is
  # skipped because it has <th> not <td>; "*" prefix => findings-for-recovery).
  RESULTS_HTML = """
  <html><body>
      <table>
          <tr>
              <th>Entity Name</th><th>County</th><th>Report Type</th>
              <th>Entity Type</th><th>Report Period</th><th>Release Date</th>
          </tr>
          <tr>
              <td><a href="/reports/audit1.pdf">Example Charity Village</a></td>
              <td>Seneca</td><td>Financial Audit</td><td>Village</td>
              <td>01/01/2021 - 12/31/2022</td><td>02/06/2024</td>
          </tr>
          <tr>
              <td><a href="/reports/audit2.pdf">* Franklin Township</a></td>
              <td>Franklin</td><td>Special Audit</td><td>Township</td>
              <td>01/01/2018 - 12/31/2022</td><td>02/06/2024</td>
          </tr>
      </table>
  </body></html>
  """


  def _resp(text: str, status_code: int = 200) -> MagicMock:
      m = MagicMock()
      m.ok = status_code < 400
      m.status_code = status_code
      m.text = text
      return m


  class OhioAOSTests(unittest.TestCase):
      @patch("investigations.ohio_aos_connector.requests.Session")
      def test_search_audit_reports_success(self, mock_session_cls):
          session = mock_session_cls.return_value
          session.get.return_value = _resp(VIEWSTATE_PAGE)
          session.post.return_value = _resp(RESULTS_HTML)

          results = search_audit_reports("Village")

          self.assertEqual(len(results), 2)
          self.assertEqual(results[0].entity_name, "Example Charity Village")
          self.assertFalse(results[0].has_findings_for_recovery)
          self.assertEqual(results[0].release_date, date(2024, 2, 6))
          self.assertEqual(results[0].pdf_url, "https://ohioauditor.gov/reports/audit1.pdf")
          self.assertEqual(results[1].entity_name, "Franklin Township")
          self.assertTrue(results[1].has_findings_for_recovery)
          self.assertEqual(results[1].county, "Franklin")

      def test_search_audit_reports_empty_query(self):
          # Raises before any HTTP, so no Session patch needed.
          with self.assertRaises(AOSError):
              search_audit_reports("")

      @patch("investigations.ohio_aos_connector.requests.Session")
      def test_search_audit_reports_http_error(self, mock_session_cls):
          session = mock_session_cls.return_value
          session.get.return_value = _resp("", 500)  # GET page itself errors
          with self.assertRaises(AOSError):
              search_audit_reports("Village")

      @patch("investigations.ohio_aos_connector.requests.Session")
      def test_missing_viewstate_raises(self, mock_session_cls):
          session = mock_session_cls.return_value
          session.get.return_value = _resp("<html><body>no hidden fields</body></html>")
          with self.assertRaises(AOSError):
              search_audit_reports("Village")


  if __name__ == "__main__":
      unittest.main()
  ```

- [ ] **Step 3: Run the module green** (now fully mocked — no network).
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_ohio_aos -v 2 --keepdb 2>&1 | tail -15
  ```
  Expected: `OK` — 4 tests pass, deterministically, offline.

- [ ] **Step 4: Commit** (Tyler):
  ```bash
  git add backend/investigations/tests/test_ohio_aos.py
  git commit -m "test(ohio_aos): patch requests.Session (was firing real HTTP); add ViewState fixture"
  ```

---

## Task B4: Delete the superseded ProPublica connector

**Files:** Delete `backend/investigations/propublica_connector.py` + `backend/investigations/tests/test_propublica.py`

Confirmed: no non-test module imports `propublica_connector` (all other `ProPublica` references are comments/docstrings/string constants). Deleting it does not affect `FinancialSnapshot.source="PROPUBLICA"` (a historical enum string).

- [ ] **Step 1: Re-confirm no live caller** (guard against drift since 2026-06-04).
  ```bash
  grep -rnE 'import .*propublica|from .*propublica' backend/investigations --include='*.py' \
    | grep -v 'tests/test_propublica.py'
  ```
  Expected: **no output** (only `test_propublica.py` imported it, and that's being deleted too).

- [ ] **Step 2: Delete both files.**
  ```bash
  git rm backend/investigations/propublica_connector.py backend/investigations/tests/test_propublica.py
  ```

- [ ] **Step 3: Confirm the suite still imports** (no dangling reference broke collection).
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_data_quality -v 1 --keepdb 2>&1 | tail -8
  ```
  Expected: `OK` (data_quality only *mentions* ProPublica in strings — it must still pass). If anything errors on a missing import, that's a real caller the grep missed — stop and resolve before committing.

- [ ] **Step 4: Commit** (Tyler):
  ```bash
  git commit -m "chore(propublica): remove superseded connector + its tests (dead code)"
  ```
  (`git rm` already staged the deletions.)

---

## Task B5: Phase B wrap — green together + record outcomes

**Files:** Modify `docs/architecture/audit-2026-06-03.md`

- [ ] **Step 1: Run all Phase B-touched modules together, green.**
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test \
       investigations.tests.test_irs \
       investigations.tests.test_county_auditor \
       investigations.tests.test_ohio_aos \
       -v 1 --keepdb 2>&1 | tail -15
  ```
  Expected: `OK`, 0 failures/0 errors. (`test_propublica` is gone — not listed.)

- [ ] **Step 2: Update the audit** (`docs/architecture/audit-2026-06-03.md`):
  - **§1.4 / §3:** add the B1 live-verify results table (connector → live status, 2026-06-04; ODNR known-down upstream).
  - **§3.2 P1-4:** mark resolved — note it became a **full rewrite** (104 dead Pub78/EO-BMF tests → unit tests for the 990-XML connector, incl. the fetch/ZIP layer per B2.7), not an import fix.
  - **§3.3 P2-5:** mark resolved — record that `test_ohio_aos` was a wrong-mock-target bug (real HTTP), and `test_county_auditor` was the ODNR URL drift.
  - **§3.3 P2-6:** mark resolved — ProPublica connector + tests deleted.
  - **New punch-list entry (residual IRS coverage gaps from B2.7's boundary):** the 990EZ/990PF variant parsers, Part VII officer parsing, and `_fetch_990_xml_full_zip` (DEFLATE64 → system `unzip`) remain untested — low priority, documented for a later pass.

- [ ] **Step 3: Commit** (Tyler):
  ```bash
  git add docs/architecture/audit-2026-06-03.md
  git commit -m "docs(audit): record Phase B outcomes (irs rewrite, ohio_aos/county_auditor fixes, propublica delete)"
  ```

---

## Definition of done (Phase B)

- [ ] B1: all five connectors live-verified; status recorded in the audit (ODNR known-down upstream, not a regression).
- [ ] B2: `test_irs.py` rewritten against the 990-XML connector — parse + search + serialization (B2 Steps 1–6) **and** the fetch/index layer (B2.7: `_stream_search_index`, `_fetch_zip_directory`, `fetch_990_xml`); module green (`OK`), ruff-clean.
- [ ] B3a: `test_county_auditor` ODNR URL assertion updated; module green.
- [ ] B3b: `test_ohio_aos` patches `requests.Session` with a ViewState fixture; module green, deterministic, offline.
- [ ] B4: `propublica_connector.py` + `test_propublica.py` deleted; suite still imports; no live caller.
- [ ] B5: the three touched test modules pass together; audit punch list updated (P1-4, P2-5, P2-6).
- [ ] No connector **logic** was changed — tests + verification + one deletion only.

---

## Self-review (completed by plan author)

- **Spec/parent coverage:** parent Phase B tasks map 1:1 — B1→B1, B2 (`test_irs`)→B2 (escalated to rewrite per owner decision), B3 (`test_county_auditor` + `test_ohio_aos`)→B3a/B3b, B4 (propublica)→B4 (delete per owner decision), plus B5 wrap (parent G2 audit-update, scoped to Phase B). ✅
- **No placeholders:** every test is real code against verified symbols/tags (`parse_990_xml` header + `CYTotalRevenueAmt`/`ScheduleBRequiredInd`; `_stream_search_index` CSV columns; `parsed_990_to_dict["source"]=="IRS_TEOS_XML"`; ohio_aos `__VIEWSTATE` gate; B2.7 builds a real `zipfile` ZIP and serves byte ranges). ✅
- **Type/seam consistency:** `_idx()` matches the real `IndexRecord` field order; search-orchestration tests mock `_stream_search_index`; B2.7 mocks `requests.get`/`requests.head` at the byte level (Range-aware) and `iter_content` for CSV streaming; ohio_aos mocks `requests.Session` (the actual call site), not `requests.get`. ✅
- **Fetch-layer fidelity (B2.7):** CSV fixture ends with `\n` (the streamer never flushes its final line buffer); ZIP tests `clear_caches()` in `setUp` (the directory is URL-cached); `_fetch_990_xml_full_zip` is explicitly excluded (system `unzip`/DEFLATE64) and logged as a residual gap. ✅
- **Classification fidelity:** B3a/B3b are explicitly "stale test, connector correct"; B2 carries the tests-for-working-code caveat (red ⇒ test wrong or real bug, never edit connector to fit a test). ✅
- **Owner decisions baked in (not guessed):** B2 rewrite, B2.7 fetch/ZIP-layer coverage (Option 2), and B4 delete are all recorded as Tyler's 2026-06-04 decisions. ✅
- **Out-of-scope honored:** no connector logic rewritten; no feature wiring; B1 is verification-only/no-commit/network-tolerant (ODNR expected 404). ✅
