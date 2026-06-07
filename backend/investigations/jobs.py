"""Background task functions for async research jobs.

Each function takes a SearchJob id (string UUID), loads the row, runs
the corresponding connector, and writes the response payload or the
exception back to the row. These functions are enqueued via
django_q.tasks.async_task from the converted research views.

Task functions are plain Python callables — Django-Q2 imports them by
dotted path, so the name and location here matter. If you rename or
move one, update the enqueue calls in views.py too.
"""

from __future__ import annotations

import logging

from django.utils import timezone

from investigations import (
    county_auditor_connector,
    irs_connector,
    ohio_aos_connector,
)
from investigations.models import JobStatus, SearchJob

logger = logging.getLogger(__name__)


def _load_and_mark_running(job_id: str) -> SearchJob | None:
    """Load a job by id, flip it to RUNNING, return it.

    Returns None if the job no longer exists (e.g. it was deleted between
    enqueue and pickup). Callers should bail out in that case.
    """
    try:
        job = SearchJob.objects.get(id=job_id)
    except SearchJob.DoesNotExist:
        logger.warning("SearchJob %s not found on pickup", job_id)
        return None

    job.status = JobStatus.RUNNING
    job.started_at = timezone.now()
    job.save(update_fields=["status", "started_at"])
    return job


def _mark_success(job: SearchJob, result: dict) -> None:
    job.status = JobStatus.SUCCESS
    job.result = result
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "result", "finished_at"])


def _mark_failed(job: SearchJob, exc: BaseException) -> None:
    job.status = JobStatus.FAILED
    job.error_message = f"{type(exc).__name__}: {exc}"
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "error_message", "finished_at"])
    logger.exception("SearchJob %s failed: %s", job.id, exc)


# ---------------------------------------------------------------------------
# IRS — name search (scan every index year)
# ---------------------------------------------------------------------------


def run_irs_name_search(job_id: str) -> None:
    job = _load_and_mark_running(job_id)
    if job is None:
        return
    try:
        query = job.query_params["query"].strip()
        filings = irs_connector.search_990_by_name(
            query,
            years=irs_connector.INDEX_YEARS,
            max_results=200,
        )
        records = [irs_connector.filing_to_dict(f) for f in filings]
        result = {
            "source": "irs_teos_xml",
            "results": records,
            "count": len(records),
            "notes": [
                "City/state not shown in search — click Fetch 990 Data to pull "
                "address and full financial/governance detail from the XML."
            ],
        }
        _mark_success(job, result)
    except Exception as exc:  # noqa: BLE001 — surface every error to the user
        _mark_failed(job, exc)


# ---------------------------------------------------------------------------
# IRS — EIN search + fetch + parse XML
# ---------------------------------------------------------------------------


def run_irs_fetch_xml(job_id: str) -> None:
    job = _load_and_mark_running(job_id)
    if job is None:
        return
    try:
        import hashlib as _hashlib

        from investigations.models import (
            Document,
            DocumentType,
            ExtractionStatus,
            FinancialSnapshot,
            OcrStatus,
            Organization,
            ScheduleLTransaction,
        )

        query = job.query_params["query"].strip()
        cleaned = query.replace("-", "").replace(" ", "")
        formatted_ein = f"{cleaned[:2]}-{cleaned[2:]}" if len(cleaned) >= 2 else cleaned
        case = job.case

        search_result = irs_connector.search_990_by_ein(cleaned, years=irs_connector.INDEX_YEARS)
        records = []
        notes = []
        snapshots_created = 0

        for filing in search_result.filings:
            record = irs_connector.filing_to_dict(filing)
            try:
                xml_text = irs_connector.fetch_990_xml(filing)
                parsed = irs_connector.parse_990_xml(
                    xml_text, filing.object_id, filing.xml_batch_id
                )
                record["parsed"] = irs_connector.parsed_990_to_dict(parsed)

                # ── Create FinancialSnapshot directly from parsed XML ──────────
                if case:
                    tax_year = parsed.tax_year or filing.tax_year
                    existing = FinancialSnapshot.objects.filter(
                        case=case,
                        ein__in=[cleaned, formatted_ein],
                        tax_year=tax_year,
                    ).first()
                    if not existing:
                        # Minimal Document record for chain-of-custody
                        xml_doc, _ = Document.objects.get_or_create(
                            case=case,
                            filename=f"irs_990_xml_{formatted_ein}_{tax_year}.xml",
                            defaults={
                                "display_name": (
                                    f"IRS Form 990 XML — "
                                    f"{parsed.taxpayer_name or formatted_ein} ({tax_year})"
                                ),
                                "doc_type": DocumentType.IRS_990,
                                "file_path": "",
                                "sha256_hash": _hashlib.sha256(
                                    filing.object_id.encode()
                                ).hexdigest(),
                                "file_size": len(xml_text.encode()),
                                "ocr_status": OcrStatus.NOT_NEEDED,
                                "extraction_status": ExtractionStatus.COMPLETED,
                                "extracted_text": xml_text[:50000],
                                "is_generated": True,
                            },
                        )
                        # Find or create Organization
                        org = Organization.objects.filter(
                            case=case, ein__in=[cleaned, formatted_ein]
                        ).first()
                        if not org and parsed.taxpayer_name:
                            org = Organization.objects.filter(
                                case=case,
                                name__iexact=parsed.taxpayer_name,
                            ).first()

                        fin = parsed.financials
                        gov = parsed.governance
                        fin = FinancialSnapshot.objects.create(
                            case=case,
                            document=xml_doc,
                            organization=org,
                            ein=formatted_ein,
                            tax_year=tax_year,
                            form_type=parsed.return_type or filing.return_type,
                            total_contributions=fin.total_contributions,
                            program_service_revenue=fin.program_service_revenue,
                            investment_income=fin.investment_income,
                            other_revenue=fin.other_revenue,
                            total_revenue=fin.total_revenue,
                            grants_paid=fin.grants_paid,
                            salaries_and_compensation=fin.salaries_and_compensation,
                            professional_fundraising=fin.professional_fundraising,
                            other_expenses=fin.other_expenses,
                            total_expenses=fin.total_expenses,
                            revenue_less_expenses=fin.revenue_less_expenses,
                            total_assets_boy=fin.total_assets_boy,
                            total_assets_eoy=fin.total_assets_eoy,
                            total_liabilities_boy=fin.total_liabilities_boy,
                            total_liabilities_eoy=fin.total_liabilities_eoy,
                            net_assets_boy=fin.net_assets_boy,
                            net_assets_eoy=fin.net_assets_eoy,
                            officer_compensation_total=parsed.total_reportable_comp_from_org,
                            num_employees=parsed.num_employees,
                            num_voting_members=gov.voting_members_governing_body,
                            num_independent_members=gov.independent_voting_members,
                            related_party_disclosed=gov.schedule_l_required,
                            has_coi_policy=gov.conflict_of_interest_policy,
                            has_whistleblower_policy=gov.whistleblower_policy,
                            has_document_retention_policy=gov.document_retention_policy,
                            source="IRS_TEOS_XML",
                            confidence=parsed.parse_quality,
                            raw_extraction=irs_connector.parsed_990_to_dict(parsed),
                        )

                        # --- Persist Schedule L transaction rows ---
                        # Each row links to both the snapshot and case for
                        # efficient signal-rule queries without extra joins.
                        if parsed.schedule_l_transactions:
                            ScheduleLTransaction.objects.bulk_create([
                                ScheduleLTransaction(
                                    snapshot=fin,
                                    case=case,
                                    tax_year=tax_year,
                                    party_name=t.get("party_name", ""),
                                    relationship_description=t.get(
                                        "relationship_description", ""
                                    ),
                                    transaction_description=t.get(
                                        "transaction_description", ""
                                    ),
                                    amount=t.get("amount"),
                                )
                                for t in parsed.schedule_l_transactions
                            ])

                        # --- Persist Schedule R and O as JSON fields ---
                        if parsed.schedule_r_orgs or parsed.schedule_o_explanations:
                            fin.schedule_r_orgs = parsed.schedule_r_orgs
                            fin.schedule_o_explanations = parsed.schedule_o_explanations
                            fin.save(
                                update_fields=["schedule_r_orgs", "schedule_o_explanations"]
                            )

                        snapshots_created += 1

            except (
                irs_connector.IRSNetworkError,
                irs_connector.IRSParseError,
            ) as e:
                record["parsed"] = None
                notes.append(f"Could not parse {filing.return_type} {filing.tax_year}: {e}")
            records.append(record)

        if search_result.total_found == 0:
            notes.append(
                f"No e-filed 990 returns found for EIN "
                f"{search_result.ein_formatted} in "
                f"{', '.join(str(y) for y in search_result.years_searched)} "
                f"indexes. The organization may file on paper or be below the "
                f"e-filing threshold."
            )

        # Run signal rules against newly-created snapshots and persist findings.
        # evaluate_case() runs all case-scoped rules including the new XML
        # snapshot rules (SR-025 modes, SR-028 enrichment, SR-030, SR-031).
        # persist_signals() deduplicates and writes Finding rows to the DB.
        if snapshots_created > 0 and case:
            try:
                from investigations.signal_rules import evaluate_case, persist_signals

                triggers = evaluate_case(case)
                persist_signals(case, triggers)
            except Exception:  # noqa: BLE001
                logger.exception("signal_rules_failed_after_xml_fetch", extra={"job_id": job_id})

        result = {
            "source": "irs_teos_xml",
            "results": records,
            "count": len(records),
            "snapshots_created": snapshots_created,
            "notes": notes,
        }
        _mark_success(job, result)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(job, exc)


# ---------------------------------------------------------------------------
# Ohio AOS — audit report scrape
# ---------------------------------------------------------------------------


def _aos_report_to_dict(report) -> dict:
    return {
        "entity_name": report.entity_name,
        "county": report.county,
        "report_type": report.report_type,
        "entity_type": report.entity_type,
        "report_period": report.report_period,
        "release_date": (report.release_date.isoformat() if report.release_date else None),
        "has_findings_for_recovery": report.has_findings_for_recovery,
        "pdf_url": report.pdf_url,
    }


def run_ohio_aos_search(job_id: str) -> None:
    job = _load_and_mark_running(job_id)
    if job is None:
        return
    try:
        query = job.query_params["query"].strip()
        reports = ohio_aos_connector.search_audit_reports(query)
        records = [_aos_report_to_dict(r) for r in reports]
        result = {
            "source": "ohio_aos",
            "results": records,
            "count": len(records),
            "notes": [],
        }
        _mark_success(job, result)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(job, exc)


# ---------------------------------------------------------------------------
# County Auditor — ODNR parcel search
# ---------------------------------------------------------------------------


def _parcel_record_to_dict(record) -> dict:
    return {
        "pin": record.pin,
        "owner1": record.owner1,
        "owner2": record.owner2,
        "county": record.county,
        "acres_calc": record.calc_acres,
        "acres_desc": record.assr_acres,
        "aud_link": record.aud_link,
    }


def run_county_parcel_search(job_id: str) -> None:
    job = _load_and_mark_running(job_id)
    if job is None:
        return
    try:
        query = job.query_params["query"].strip()
        county_str = job.query_params.get("county") or ""
        search_type = (job.query_params.get("search_type") or "owner").lower()

        # Resolve county string to the OhioCounty enum (or None)
        county = None
        if county_str:
            try:
                county = county_auditor_connector.OhioCounty[county_str.upper()]
            except KeyError:
                _mark_failed(
                    job,
                    ValueError(
                        f"Invalid county: {county_str!r}. Must be a valid Ohio county name."
                    ),
                )
                return

        if search_type == "parcel":
            result_obj = county_auditor_connector.search_parcels_by_pin(query, county=county)
        else:
            result_obj = county_auditor_connector.search_parcels_by_owner(query, county=county)

        records = [_parcel_record_to_dict(r) for r in result_obj.records]
        notes = [result_obj.note] if result_obj.note else []
        result = {
            "source": "county_auditor",
            "results": records,
            "count": len(records),
            "notes": notes,
        }
        _mark_success(job, result)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(job, exc)


# ---------------------------------------------------------------------------
# AI Pattern Analysis
# ---------------------------------------------------------------------------


def run_ai_pattern_analysis(job_id: str) -> None:
    job = _load_and_mark_running(job_id)
    if job is None:
        return
    try:
        from investigations import ai_pattern_augmentation

        case_id = job.query_params["case_id"]
        # Pass the job object so analyze_case can link findings back to this
        # run and stamp the model version into evidence_snapshot.
        summary = ai_pattern_augmentation.analyze_case(case_id, job=job)
        _mark_success(job, summary)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(job, exc)


# ---------------------------------------------------------------------------
# AI Ask — free-form case question (tool-use loop, up to 6 Claude calls)
# ---------------------------------------------------------------------------


def run_ai_ask(job_id: str) -> None:
    """Process a free-form investigator question about a case.

    Runs ai_ask() in the background so the 10–40 second tool-use loop
    doesn't block a Django web worker. The frontend polls
    GET /api/jobs/<id>/ for status; on SUCCESS the result dict carries
    the same shape ai_ask() previously returned synchronously:
    {"answer": str, "sources": [...], "tool_calls_made": [...], ...}
    """
    job = _load_and_mark_running(job_id)
    if job is None:
        return
    try:
        from django.core.cache import cache as _cache

        from investigations.ai_proxy import ai_ask
        from investigations.models import Case

        case = Case.objects.get(id=job.query_params["case_id"])

        # Retrieve conversation history from the shared cache — the full
        # transcript is never stored in query_params (security: job params
        # are readable via the public jobs API).
        history_ref = job.query_params.get("history_ref", "")
        if history_ref:
            conversation_history = _cache.get(f"ai_ask_history:{history_ref}")
            if conversation_history is None:
                # Cache entry expired or was evicted before the worker ran.
                # Fail fast so the caller knows the session context was lost
                # rather than silently answering without conversation history.
                raise ValueError(
                    f"Conversation history cache miss: history_ref={history_ref!r} "
                    f"has expired or been evicted. The session must be restarted."
                )
        else:
            conversation_history = []

        result = ai_ask(
            case,
            question=job.query_params["question"],
            conversation_history=conversation_history,
        )
        # ai_ask returns {"error": "..."} on rate-limit or API failure —
        # surface that as a FAILED job so the frontend can render it clearly.
        if "error" in result:
            _mark_failed(job, ValueError(result["error"]))
        else:
            _mark_success(job, result)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(job, exc)
