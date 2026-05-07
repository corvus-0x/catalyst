/**
 * graph.ts — API functions for the entity-relationship Web (graph) and entity profiles.
 *
 * The graph endpoint powers the Cytoscape.js "Web" canvas on the Investigate tab.
 * It also returns `timeline_events` used by the D3 Timeline brush.
 *
 * Entity detail (GET /api/entities/:type/:id/) powers the Level 2 Profile drill-down
 * inside the Web. Per the API contract, ignore `related_signals` — use `related_findings`
 * (summary shape) for the compact profile sidebar list.
 */

import { fetchApi } from "./base";
import type {
  GraphResponse,
  EntityBrowserResponse,
  EntityDetailResponse,
} from "../types";

// ---------------------------------------------------------------------------
// Graph (the "Web")
// ---------------------------------------------------------------------------

/**
 * Fetch the entity-relationship graph for a case.
 *
 * Returns nodes (Person/Organization/Property/FinancialInstrument),
 * edges with `finding_links` for severity-coloured strokes,
 * and `timeline_events` for the D3 brushable timeline.
 *
 * Edge colour guide (from finding_links severity):
 *   CRITICAL -> coral #D85A30
 *   HIGH     -> amber #BA7517
 *   MEDIUM   -> blue  #185FA5
 *   Empty    -> default grey
 *
 * Cytoscape layout: cytoscape-cose-bilkent (NOT D3 force simulation).
 */
export async function fetchGraph(caseId: string): Promise<GraphResponse> {
  return fetchApi<GraphResponse>(`/api/cases/${caseId}/graph/`);
}

// ---------------------------------------------------------------------------
// Entity browser (cross-case)
// ---------------------------------------------------------------------------

export interface EntityListParams {
  type?: "person" | "organization" | "property" | "financial_instrument";
  q?: string;
  case_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Search/browse entities across all cases (or scoped to one case).
 *
 * Returns a discriminated union: items may be Person, Organization, Property,
 * or FinancialInstrument. All share `id`, `entity_type`, `name`, `case_id`,
 * `case_name`. Type-specific fields are only present on their own type.
 *
 * Note: In the new frontend spec, there is no standalone Entity Browser route.
 * Entity detail is the Level 2 Profile drill-down within the Web. This function
 * is used for the entity picker in Angle creation and the Cmd+K search palette.
 */
export async function fetchEntities(
  params: EntityListParams = {}
): Promise<EntityBrowserResponse> {
  const qs = new URLSearchParams();
  if (params.type) qs.set("type", params.type);
  if (params.q) qs.set("q", params.q);
  if (params.case_id) qs.set("case_id", params.case_id);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString() ? `?${qs}` : "";
  return fetchApi<EntityBrowserResponse>(`/api/entities/${query}`);
}

// ---------------------------------------------------------------------------
// Entity detail (Profile drill-down -- Level 2 in the Web)
// ---------------------------------------------------------------------------

/**
 * Fetch the full profile for a single entity.
 *
 * `type` must match the entity's actual type: "person" | "organization" |
 * "property" | "financial_instrument".
 *
 * Response includes:
 *   - `related_documents` -- full DocumentItem shapes with page_reference and context_note
 *   - `related_findings` -- compact finding summaries (use this, ignore related_signals)
 *   - `organization_roles` -- for persons: list of org roles with dates
 *   - `transactions` -- for properties: list of PropertyTransaction shapes
 *
 * Per API contract GAP-3: `related_signals` duplicates `related_findings` in a
 * different shape. Ignore `related_signals` in the UI.
 */
export async function fetchEntityDetail(
  type: "person" | "organization" | "property" | "financial_instrument",
  entityId: string
): Promise<EntityDetailResponse> {
  return fetchApi<EntityDetailResponse>(`/api/entities/${type}/${entityId}/`);
}
