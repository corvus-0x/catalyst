from django.test import Client, TestCase
from django.urls import reverse

from ..models import (
    Case,
    Document,
    DocumentType,
    EvidenceWeight,
    ExtractionStatus,
    Finding,
    FindingDocument,
    FindingStatus,
    FuzzyMatchCandidate,
    JobStatus,
    JobType,
    OcrStatus,
    ReferralTarget,
    SearchJob,
    Severity,
)


class ReferralReadinessTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="Referral Readiness Case")

    def _get_readiness(self):
        response = self.client.get(reverse("api_case_referral_readiness", args=[self.case.pk]))
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _get_dashboard(self):
        response = self.client.get(reverse("api_case_dashboard", args=[self.case.pk]))
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _document(self, suffix="a", **overrides):
        data = {
            "case": self.case,
            "filename": f"evidence-{suffix}.pdf",
            "file_path": f"cases/test/evidence-{suffix}.pdf",
            "sha256_hash": suffix * 64,
            "file_size": 1024,
            "doc_type": DocumentType.DEED,
            "ocr_status": OcrStatus.COMPLETED,
            "extraction_status": ExtractionStatus.COMPLETED,
        }
        data.update(overrides)
        return Document.objects.create(**data)

    def _confirmed_finding(self, **overrides):
        data = {
            "case": self.case,
            "rule_id": "SR-015",
            "title": "Insider property swap",
            "description": "Related party transaction.",
            "severity": Severity.CRITICAL,
            "status": FindingStatus.CONFIRMED,
            "evidence_weight": EvidenceWeight.DOCUMENTED,
        }
        data.update(overrides)
        return Finding.objects.create(**data)

    def _target(self):
        return ReferralTarget.objects.create(
            case=self.case,
            agency_name="Ohio AG",
            complaint_type="Charitable fraud",
        )

    def test_readiness_blocks_without_target_or_confirmed_angles(self):
        payload = self._get_readiness()

        self.assertEqual(payload["status"], "BLOCKED")
        self.assertEqual(payload["quality"]["status"], "BLOCKED")
        self.assertEqual(payload["quality"]["grade"], "Blocked")
        self.assertLessEqual(payload["quality"]["score"], 69)
        top_labels = [issue["label"] for issue in payload["quality"]["top_issues"]]
        self.assertIn("Referral target", top_labels)
        self.assertIn("Confirmed angles", top_labels)
        by_key = {item["key"]: item for item in payload["items"]}
        self.assertEqual(by_key["referral_target"]["status"], "FAIL")
        self.assertEqual(by_key["confirmed_angles"]["status"], "FAIL")

    def test_readiness_blocks_confirmed_angle_without_citation(self):
        self._target()
        self._confirmed_finding()

        payload = self._get_readiness()

        self.assertEqual(payload["status"], "BLOCKED")
        self.assertEqual(payload["quality"]["status"], "BLOCKED")
        self.assertLessEqual(payload["quality"]["score"], 69)
        by_key = {item["key"]: item for item in payload["items"]}
        self.assertEqual(by_key["citation_coverage"]["status"], "FAIL")
        self.assertEqual(by_key["citation_coverage"]["count"], 1)

    def test_readiness_blocks_confirmed_angle_without_referral_evidence_weight(self):
        self._target()
        finding = self._confirmed_finding(evidence_weight=EvidenceWeight.SPECULATIVE)
        FindingDocument.objects.create(finding=finding, document=self._document())

        payload = self._get_readiness()

        self.assertEqual(payload["status"], "BLOCKED")
        self.assertEqual(payload["quality"]["status"], "BLOCKED")
        self.assertLessEqual(payload["quality"]["score"], 69)
        by_key = {item["key"]: item for item in payload["items"]}
        self.assertEqual(by_key["evidence_weight"]["status"], "FAIL")

    def test_readiness_warns_for_mixed_referral_evidence_weight(self):
        self._target()
        documented = self._confirmed_finding(evidence_weight=EvidenceWeight.DOCUMENTED)
        directional = self._confirmed_finding(
            title="Directional angle",
            evidence_weight=EvidenceWeight.DIRECTIONAL,
        )
        FindingDocument.objects.create(finding=documented, document=self._document("a"))
        FindingDocument.objects.create(finding=directional, document=self._document("b"))

        payload = self._get_readiness()

        self.assertEqual(payload["status"], "NEEDS_REVIEW")
        self.assertEqual(payload["quality"]["status"], "NEEDS_REVIEW")
        by_key = {item["key"]: item for item in payload["items"]}
        self.assertEqual(by_key["evidence_weight"]["status"], "WARN")

    def test_readiness_warns_for_pending_review_items(self):
        self._target()
        finding = self._confirmed_finding()
        FindingDocument.objects.create(finding=finding, document=self._document())
        FuzzyMatchCandidate.objects.create(
            case=self.case,
            entity_type="person",
            incoming_raw="T Collins",
            incoming_normalized="t collins",
            existing_entity_id=finding.id,
            existing_raw="Tyler Collins",
            similarity=0.91,
        )
        self._document(
            suffix="b",
            ocr_status=OcrStatus.PENDING,
            extraction_status=ExtractionStatus.PENDING,
        )
        SearchJob.objects.create(
            case=self.case,
            job_type=JobType.IRS_NAME_SEARCH,
            status=JobStatus.RUNNING,
            query_params={"name": "test"},
        )

        payload = self._get_readiness()

        self.assertEqual(payload["status"], "NEEDS_REVIEW")
        self.assertEqual(payload["quality"]["status"], "NEEDS_REVIEW")
        self.assertEqual(payload["quality"]["grade"], "Review needed")
        self.assertLessEqual(payload["quality"]["score"], 89)
        self.assertLessEqual(len(payload["quality"]["top_issues"]), 3)
        self.assertTrue(
            all(issue["status"] == "WARN" for issue in payload["quality"]["top_issues"])
        )
        by_key = {item["key"]: item for item in payload["items"]}
        self.assertEqual(by_key["pending_connections"]["status"], "WARN")
        self.assertEqual(by_key["pending_extraction"]["status"], "WARN")
        self.assertEqual(by_key["active_jobs"]["status"], "WARN")

    def test_readiness_blocks_for_failed_source_document_intake(self):
        self._target()
        finding = self._confirmed_finding()
        FindingDocument.objects.create(finding=finding, document=self._document())
        self._document(
            suffix="c",
            ocr_status=OcrStatus.FAILED,
            extraction_status=ExtractionStatus.FAILED,
        )

        payload = self._get_readiness()

        self.assertEqual(payload["status"], "BLOCKED")
        self.assertEqual(payload["quality"]["status"], "BLOCKED")
        self.assertLessEqual(payload["quality"]["score"], 69)
        by_key = {item["key"]: item for item in payload["items"]}
        self.assertEqual(by_key["failed_extraction"]["status"], "FAIL")

    def test_readiness_ready_when_all_checks_pass(self):
        self._target()
        finding = self._confirmed_finding(evidence_weight=EvidenceWeight.TRACED)
        FindingDocument.objects.create(finding=finding, document=self._document())

        payload = self._get_readiness()

        self.assertEqual(payload["status"], "READY")
        self.assertEqual(payload["quality"]["status"], "READY")
        self.assertEqual(payload["quality"]["grade"], "Strong")
        self.assertEqual(payload["quality"]["score"], 100)
        self.assertEqual(payload["quality"]["top_issues"], [])
        self.assertTrue(all(item["status"] == "PASS" for item in payload["items"]))

    def test_dashboard_quality_matches_readiness_quality(self):
        self._target()
        finding = self._confirmed_finding(evidence_weight=EvidenceWeight.TRACED)
        FindingDocument.objects.create(finding=finding, document=self._document())

        readiness = self._get_readiness()
        dashboard = self._get_dashboard()

        self.assertEqual(dashboard["quality"], readiness["quality"])
