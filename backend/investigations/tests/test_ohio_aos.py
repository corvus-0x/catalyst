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
