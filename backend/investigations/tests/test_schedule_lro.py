"""
Tests for Schedule L/R/O parsing in irs_connector.py.

Pure Python — no Django, no DB, no network. Safe to run locally.
"""
import textwrap
import unittest

IRS_NS = "http://www.irs.gov/efile"

# Minimal XML fixture with Schedule L (1 transaction), R (1 org), O (1 explanation)
_FIXTURE_XML = textwrap.dedent(f"""\
    <?xml version="1.0" encoding="UTF-8"?>
    <Return xmlns="{IRS_NS}">
      <ReturnHeader>
        <TaxYr>2022</TaxYr>
        <TaxPeriodEndDt>2022-12-31</TaxPeriodEndDt>
        <ReturnTypeCd>990</ReturnTypeCd>
        <Filer>
          <EIN>820045001</EIN>
          <BusinessName><BusinessNameLine1Txt>Test Charity</BusinessNameLine1Txt></BusinessName>
        </Filer>
      </ReturnHeader>
      <ReturnData>
        <IRS990>
          <CYTotalRevenueAmt>1000000</CYTotalRevenueAmt>
          <CYTotalExpensesAmt>900000</CYTotalExpensesAmt>
          <NetAssetsOrFundBalancesEOYAmt>200000</NetAssetsOrFundBalancesEOYAmt>
          <IndependentVotingMemberCnt>0</IndependentVotingMemberCnt>
        </IRS990>
        <IRS990ScheduleL>
          <TransactionsRelatedOrgGrp>
            <NameOfInterested>Jay Example</NameOfInterested>
            <RelationshipWithOrganizationTxt>Officer</RelationshipWithOrganizationTxt>
            <Desc>Lease agreement for office space</Desc>
            <TransactionAmt>24000</TransactionAmt>
          </TransactionsRelatedOrgGrp>
        </IRS990ScheduleL>
        <IRS990ScheduleR>
          <IdRelatedTaxExemptOrgGrp>
            <OrganizationName><BusinessNameLine1Txt>Example LLC</BusinessNameLine1Txt></OrganizationName>
            <EIN>820045002</EIN>
            <ExemptCodeSectionTxt>501(c)(3)</ExemptCodeSectionTxt>
            <PrimaryActivitiesTxt>Real estate management</PrimaryActivitiesTxt>
          </IdRelatedTaxExemptOrgGrp>
        </IRS990ScheduleR>
        <IRS990ScheduleO>
          <SupplementalInformationDetail>
            <FormAndLineReferenceDesc>Part VI Line 5</FormAndLineReferenceDesc>
            <ExplanationTxt>The organization became aware of a material diversion of $50,000.</ExplanationTxt>
          </SupplementalInformationDetail>
        </IRS990ScheduleO>
      </ReturnData>
    </Return>
""")

_FIXTURE_XML_NO_SCHEDULES = textwrap.dedent(f"""\
    <?xml version="1.0" encoding="UTF-8"?>
    <Return xmlns="{IRS_NS}">
      <ReturnHeader>
        <TaxYr>2021</TaxYr>
        <TaxPeriodEndDt>2021-12-31</TaxPeriodEndDt>
        <ReturnTypeCd>990</ReturnTypeCd>
        <Filer>
          <EIN>820045001</EIN>
          <BusinessName><BusinessNameLine1Txt>Test Charity</BusinessNameLine1Txt></BusinessName>
        </Filer>
      </ReturnHeader>
      <ReturnData>
        <IRS990>
          <CYTotalRevenueAmt>500000</CYTotalRevenueAmt>
        </IRS990>
      </ReturnData>
    </Return>
""")


class ParseScheduleLTests(unittest.TestCase):
    def test_schedule_l_transaction_parsed(self):
        from investigations.irs_connector import parse_990_xml
        result = parse_990_xml(_FIXTURE_XML)
        self.assertEqual(len(result.schedule_l_transactions), 1)
        txn = result.schedule_l_transactions[0]
        self.assertEqual(txn["party_name"], "Jay Example")
        self.assertEqual(txn["relationship_description"], "Officer")
        self.assertEqual(txn["transaction_description"], "Lease agreement for office space")
        self.assertEqual(txn["amount"], 24000)

    def test_schedule_r_org_parsed(self):
        from investigations.irs_connector import parse_990_xml
        result = parse_990_xml(_FIXTURE_XML)
        self.assertEqual(len(result.schedule_r_orgs), 1)
        org = result.schedule_r_orgs[0]
        self.assertEqual(org["name"], "Example LLC")
        self.assertEqual(org["ein"], "820045002")
        self.assertEqual(org["org_type"], "501(c)(3)")
        self.assertEqual(org["description"], "Real estate management")

    def test_schedule_o_explanation_parsed(self):
        from investigations.irs_connector import parse_990_xml
        result = parse_990_xml(_FIXTURE_XML)
        self.assertEqual(len(result.schedule_o_explanations), 1)
        entry = result.schedule_o_explanations[0]
        self.assertEqual(entry["form_line_reference"], "Part VI Line 5")
        self.assertIn("material diversion", entry["explanation_text"])

    def test_missing_schedules_return_empty_lists(self):
        from investigations.irs_connector import parse_990_xml
        result = parse_990_xml(_FIXTURE_XML_NO_SCHEDULES)
        self.assertEqual(result.schedule_l_transactions, [])
        self.assertEqual(result.schedule_r_orgs, [])
        self.assertEqual(result.schedule_o_explanations, [])


if __name__ == "__main__":
    unittest.main()
