"""Unit tests for the job-status endpoints and converted research views."""

import json
from unittest import mock

from django.test import Client, TestCase
from django.urls import reverse

from investigations.models import Case, JobStatus, JobType, SearchJob


class JobDetailViewTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="T")

    def test_returns_job_state_for_queued(self):
        job = SearchJob.objects.create(
            case=self.case,
            job_type=JobType.IRS_NAME_SEARCH,
            query_params={"query": "x"},
        )
        resp = self.client.get(reverse("api_job_detail", args=[job.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["id"], str(job.id))
        self.assertEqual(data["status"], "QUEUED")
        self.assertEqual(data["job_type"], "IRS_NAME_SEARCH")
        self.assertIsNone(data["result"])
        self.assertEqual(data["error_message"], "")

    def test_returns_result_for_success(self):
        payload = {"source": "irs_teos_xml", "results": [], "count": 0, "notes": []}
        job = SearchJob.objects.create(
            case=self.case,
            job_type=JobType.IRS_NAME_SEARCH,
            query_params={"query": "x"},
            status=JobStatus.SUCCESS,
            result=payload,
        )
        resp = self.client.get(reverse("api_job_detail", args=[job.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["result"], payload)

    def test_404_for_unknown_id(self):
        import uuid

        resp = self.client.get(reverse("api_job_detail", args=[uuid.uuid4()]))
        self.assertEqual(resp.status_code, 404)


class CaseJobsViewTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="T")
        self.other = Case.objects.create(name="Other")

    def test_lists_jobs_for_case_most_recent_first(self):
        jobs = [
            SearchJob.objects.create(
                case=self.case,
                job_type=JobType.IRS_NAME_SEARCH,
                query_params={"n": i},
            )
            for i in range(3)
        ]
        SearchJob.objects.create(
            case=self.other,
            job_type=JobType.IRS_NAME_SEARCH,
            query_params={"n": "other"},
        )
        resp = self.client.get(reverse("api_case_jobs", args=[self.case.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["results"]), 3)
        returned_ids = [r["id"] for r in data["results"]]
        self.assertEqual(returned_ids[0], str(jobs[-1].id))

    def test_respects_limit_query_param(self):
        for i in range(10):
            SearchJob.objects.create(
                case=self.case,
                job_type=JobType.IRS_NAME_SEARCH,
                query_params={"n": i},
            )
        resp = self.client.get(reverse("api_case_jobs", args=[self.case.id]) + "?limit=5")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["results"]), 5)


class ConvertedResearchViewTests(TestCase):
    """The four converted POST views should now enqueue and return 202."""

    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="T")

    @mock.patch("investigations.views.async_task")
    def test_research_irs_name_search_returns_202(self, mock_async):
        resp = self.client.post(
            reverse("api_research_irs", args=[self.case.id]),
            data=json.dumps({"query": "bright future"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        data = resp.json()
        self.assertIn("job_id", data)
        self.assertIn("status_url", data)
        self.assertEqual(SearchJob.objects.count(), 1)
        job = SearchJob.objects.first()
        self.assertEqual(job.job_type, JobType.IRS_NAME_SEARCH)
        self.assertEqual(job.query_params["query"], "bright future")
        mock_async.assert_called_once()
        args, _ = mock_async.call_args
        self.assertEqual(args[0], "investigations.jobs.run_irs_name_search")
        self.assertEqual(args[1], str(job.id))

    @mock.patch("investigations.views.async_task")
    def test_research_irs_ein_with_fetch_xml_uses_fetch_xml_job_type(self, mock_async):
        resp = self.client.post(
            reverse("api_research_irs", args=[self.case.id]),
            data=json.dumps({"query": "12-3456789", "fetch_xml": True}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        job = SearchJob.objects.first()
        self.assertEqual(job.job_type, JobType.IRS_FETCH_XML)

    @mock.patch("investigations.views.async_task")
    def test_research_ohio_aos_returns_202(self, mock_async):
        resp = self.client.post(
            reverse("api_research_ohio_aos", args=[self.case.id]),
            data=json.dumps({"query": "Bright Future"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        job = SearchJob.objects.first()
        self.assertEqual(job.job_type, JobType.OHIO_AOS)

    @mock.patch("investigations.views.async_task")
    def test_research_parcels_returns_202(self, mock_async):
        resp = self.client.post(
            reverse("api_research_parcels", args=[self.case.id]),
            data=json.dumps({"query": "Smith", "county": "Darke"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        job = SearchJob.objects.first()
        self.assertEqual(job.job_type, JobType.COUNTY_PARCEL)

    @mock.patch("investigations.views.async_task")
    def test_research_parcels_persists_search_type(self, mock_async):
        resp = self.client.post(
            reverse("api_research_parcels", args=[self.case.id]),
            data=json.dumps(
                {"query": "1234-5678-9012", "county": "Darke", "search_type": "parcel"}
            ),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        job = SearchJob.objects.first()
        self.assertEqual(job.query_params["search_type"], "parcel")

    @mock.patch("investigations.views.async_task")
    def test_research_parcels_defaults_search_type_to_owner(self, mock_async):
        resp = self.client.post(
            reverse("api_research_parcels", args=[self.case.id]),
            data=json.dumps({"query": "Smith", "county": "Darke"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        job = SearchJob.objects.first()
        self.assertEqual(job.query_params["search_type"], "owner")

    def test_research_irs_missing_query_returns_400(self):
        resp = self.client.post(
            reverse("api_research_irs", args=[self.case.id]),
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(SearchJob.objects.count(), 0)


class AIAnalyzePatternsViewTests(TestCase):
    """The /ai/analyze-patterns/ endpoint must enforce one in-flight job per case.

    Each Claude call costs real tokens, so a double-click or two-tab POST must
    not enqueue twice.
    """

    def setUp(self):
        self.client = Client()
        self.case = Case.objects.create(name="T")

    @mock.patch("investigations.views.async_task")
    def test_first_request_returns_202_and_enqueues(self, mock_async):
        resp = self.client.post(
            reverse("api_ai_analyze_patterns", args=[self.case.id]),
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(SearchJob.objects.count(), 1)
        job = SearchJob.objects.first()
        self.assertEqual(job.job_type, JobType.AI_PATTERN_ANALYSIS)
        mock_async.assert_called_once()

    @mock.patch("investigations.views.async_task")
    def test_second_request_returns_409_when_queued_job_in_flight(self, mock_async):
        SearchJob.objects.create(
            case=self.case,
            job_type=JobType.AI_PATTERN_ANALYSIS,
            status=JobStatus.QUEUED,
            query_params={"case_id": str(self.case.id)},
        )
        resp = self.client.post(
            reverse("api_ai_analyze_patterns", args=[self.case.id]),
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(SearchJob.objects.count(), 1)
        mock_async.assert_not_called()

    @mock.patch("investigations.views.async_task")
    def test_second_request_returns_409_when_running_job_in_flight(self, mock_async):
        SearchJob.objects.create(
            case=self.case,
            job_type=JobType.AI_PATTERN_ANALYSIS,
            status=JobStatus.RUNNING,
            query_params={"case_id": str(self.case.id)},
        )
        resp = self.client.post(
            reverse("api_ai_analyze_patterns", args=[self.case.id]),
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 409)
        mock_async.assert_not_called()

    @mock.patch("investigations.views.async_task")
    def test_completed_job_does_not_block_new_request(self, mock_async):
        SearchJob.objects.create(
            case=self.case,
            job_type=JobType.AI_PATTERN_ANALYSIS,
            status=JobStatus.SUCCESS,
            query_params={"case_id": str(self.case.id)},
            result={"findings_created": 2, "patterns_dropped": 0},
        )
        resp = self.client.post(
            reverse("api_ai_analyze_patterns", args=[self.case.id]),
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(SearchJob.objects.count(), 2)
        mock_async.assert_called_once()

    @mock.patch("investigations.views.async_task")
    def test_in_flight_job_on_other_case_does_not_block(self, mock_async):
        other_case = Case.objects.create(name="Other")
        SearchJob.objects.create(
            case=other_case,
            job_type=JobType.AI_PATTERN_ANALYSIS,
            status=JobStatus.RUNNING,
            query_params={"case_id": str(other_case.id)},
        )
        resp = self.client.post(
            reverse("api_ai_analyze_patterns", args=[self.case.id]),
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 202)
        mock_async.assert_called_once()
