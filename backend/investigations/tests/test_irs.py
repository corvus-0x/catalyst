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
        index_year=int(tax_period[:4]) if len(tax_period) >= 4 else 0,
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
            f'<R xmlns="{ns}"><Name>Acme</Name><Amt>1234.00</Amt><Flag>true</Flag></R>'
        )
        self.assertEqual(_text(root, "Name"), "Acme")
        self.assertEqual(_int(root, "Amt"), 1234)  # handles decimal text
        self.assertIs(_bool(root, "Flag"), True)
        self.assertIsNone(_int(root, "Missing"))
        self.assertIsNone(_bool(root, "Missing"))


# --- parse_990_xml --------------------------------------------------------

# SAMPLE_990 includes all five quality-score fields so parse_quality == 1.0:
#   total_revenue (CYTotalRevenueAmt)
#   total_expenses (CYTotalExpensesAmt)
#   total_assets_eoy (TotalAssetsEOYAmt)
#   conflict_of_interest_policy (ConflictOfInterestPolicyInd)
#   voting_members_governing_body (GoverningBodyVotingMembersCnt)
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
      <TotalAssetsEOYAmt>8000000</TotalAssetsEOYAmt>
      <GoverningBodyVotingMembersCnt>7</GoverningBodyVotingMembersCnt>
      <ConflictOfInterestPolicyInd>true</ConflictOfInterestPolicyInd>
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
        mock_stream.side_effect = [[_idx("A", return_type="990"), _idx("B", return_type="990EZ")]]
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


# --- 990EZ / 990PF variant parsers ----------------------------------------

SAMPLE_990EZ = """<?xml version="1.0" encoding="UTF-8"?>
<Return xmlns="http://www.irs.gov/efile">
  <ReturnHeader>
    <ReturnTypeCd>990EZ</ReturnTypeCd>
    <TaxYr>2022</TaxYr>
    <Filer>
      <EIN>987654321</EIN>
      <BusinessName>
        <BusinessNameLine1Txt>Tiny Helpers Inc</BusinessNameLine1Txt>
      </BusinessName>
    </Filer>
  </ReturnHeader>
  <ReturnData>
    <IRS990EZ>
      <LegalDomicileStateCd>OH</LegalDomicileStateCd>
      <PrimaryExemptPurposeTxt>Help the community.</PrimaryExemptPurposeTxt>
      <ContributionsGiftsGrantsEtcAmt>50000</ContributionsGiftsGrantsEtcAmt>
      <TotalRevenueAmt>60000</TotalRevenueAmt>
      <TotalExpensesAmt>55000</TotalExpensesAmt>
      <ExcessOrDeficitForYearAmt>5000</ExcessOrDeficitForYearAmt>
      <OfficerDirectorTrusteeEmplGrp>
        <PersonNm>Jane Officer</PersonNm>
        <TitleTxt>President</TitleTxt>
        <AverageHrsPerWkDevotedToPosRt>10.00</AverageHrsPerWkDevotedToPosRt>
        <CompensationAmt>0</CompensationAmt>
      </OfficerDirectorTrusteeEmplGrp>
    </IRS990EZ>
  </ReturnData>
</Return>
"""

SAMPLE_990PF = """<?xml version="1.0" encoding="UTF-8"?>
<Return xmlns="http://www.irs.gov/efile">
  <ReturnHeader>
    <ReturnTypeCd>990PF</ReturnTypeCd>
    <TaxYr>2022</TaxYr>
    <Filer>
      <EIN>111222333</EIN>
      <BusinessName>
        <BusinessNameLine1Txt>Rich Family Foundation</BusinessNameLine1Txt>
      </BusinessName>
    </Filer>
  </ReturnHeader>
  <ReturnData>
    <IRS990PF>
      <AnalysisOfRevenueAndExpenses>
        <ContriRcvdRevAndExpnssAmt>1000000</ContriRcvdRevAndExpnssAmt>
        <TotalRevAndExpnssAmt>1200000</TotalRevAndExpnssAmt>
        <TotOprExpensesRevAndExpnssAmt>800000</TotOprExpensesRevAndExpnssAmt>
        <ExcessRevenueOverExpensesAmt>400000</ExcessRevenueOverExpensesAmt>
      </AnalysisOfRevenueAndExpenses>
      <Form990PFBalanceSheetsGrp>
        <TotalAssetsBOYGrp><BOYAmt>5000000</BOYAmt></TotalAssetsBOYGrp>
        <TotalAssetsEOYGrp><EOYAmt>5400000</EOYAmt></TotalAssetsEOYGrp>
      </Form990PFBalanceSheetsGrp>
      <OfficerDirTrstKeyEmplInfoGrp>
        <OfficerDirTrstKeyEmplGrp>
          <PersonNm>Rich Person</PersonNm>
          <TitleTxt>Trustee</TitleTxt>
          <AverageHrsPerWkDevotedToPosRt>2.00</AverageHrsPerWkDevotedToPosRt>
          <CompensationAmt>0</CompensationAmt>
        </OfficerDirTrstKeyEmplGrp>
      </OfficerDirTrstKeyEmplInfoGrp>
    </IRS990PF>
  </ReturnData>
</Return>
"""


class Parse990EZTests(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_990_xml(SAMPLE_990EZ)

    def test_return_type_and_quality(self):
        self.assertEqual(self.parsed.return_type, "990EZ")
        self.assertAlmostEqual(self.parsed.parse_quality, 0.6)

    def test_financials(self):
        f = self.parsed.financials
        self.assertEqual(f.total_contributions, 50000)
        self.assertEqual(f.total_revenue, 60000)
        self.assertEqual(f.total_expenses, 55000)
        self.assertEqual(f.revenue_less_expenses, 5000)

    def test_state_and_mission(self):
        self.assertEqual(self.parsed.state, "OH")
        self.assertIn("Help", self.parsed.mission)

    def test_officer_parsed(self):
        self.assertEqual(len(self.parsed.officers), 1)
        o = self.parsed.officers[0]
        self.assertEqual(o.name, "Jane Officer")
        self.assertEqual(o.title, "President")
        self.assertTrue(o.is_officer)


class Parse990PFTests(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_990_xml(SAMPLE_990PF)

    def test_return_type_and_quality(self):
        self.assertEqual(self.parsed.return_type, "990PF")
        self.assertAlmostEqual(self.parsed.parse_quality, 0.5)

    def test_financials_from_analysis(self):
        f = self.parsed.financials
        self.assertEqual(f.total_contributions, 1000000)
        self.assertEqual(f.total_revenue, 1200000)
        self.assertEqual(f.total_expenses, 800000)
        self.assertEqual(f.revenue_less_expenses, 400000)

    def test_balance_sheet(self):
        f = self.parsed.financials
        self.assertEqual(f.total_assets_boy, 5000000)
        self.assertEqual(f.total_assets_eoy, 5400000)

    def test_officer_parsed(self):
        self.assertEqual(len(self.parsed.officers), 1)
        o = self.parsed.officers[0]
        self.assertEqual(o.name, "Rich Person")
        self.assertEqual(o.title, "Trustee")


if __name__ == "__main__":
    unittest.main()
