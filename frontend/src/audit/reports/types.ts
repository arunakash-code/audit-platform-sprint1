import type { ControlTest, Engagement, QueryRow } from "../types";

export type ReportDetails = {
  reference_no: string;
  audit_area: string;
  report_status: "Draft" | "Final";
  overall_rating: "" | "High" | "Medium" | "Low";
  fieldwork_start: string | null;
  fieldwork_end: string | null;
  exit_meeting_date: string | null;
  prepared_by: string;
  prepared_by_designation: string;
  reviewed_by: string;
  reviewed_by_designation: string;
  distribution: string;
  objectives: string[];
  entity_locations: string;
  out_of_scope: string;
  approach: string;
  sampling_basis: string;
  limitations: string;
  overall_assessment: string | null;
  key_highlights: string[];
  conclusion: string | null;
  department: string;
  abbreviations: { abbr: string; meaning: string }[];
};

export type ReportData = {
  firm: string;
  details: ReportDetails;
  generated_at: string;
  generated_by: string;
  engagement: Engagement & { client: NonNullable<Engagement["client"]> };
  summary: {
    processes: number;
    controls: number;
    passed: number;
    failed: number;
    queries_open: number;
    queries_closed: number;
    failed_by_rating: { high: number; medium: number; low: number };
  };
  processes: {
    id: number;
    code: string | null;
    name: string;
    assignee: string | null;
    completed_at: string | null;
    controls: number;
    passed: number;
    failed: number;
    risks: { code: string | null; title: string; rating: string; controls: ControlTest[] }[];
  }[];
  queries: QueryRow[];
};

export const auditTypeLabel = (t: string) => (t === "statutory" ? "Statutory audit" : "Internal audit");

export const longDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

export const fileBase = (r: ReportData) =>
  `${r.engagement.client.name} ${r.engagement.period === "FY" ? r.engagement.fy_label : `${r.engagement.fy_label} ${r.engagement.period}`} ${auditTypeLabel(r.engagement.audit_type)}`
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
