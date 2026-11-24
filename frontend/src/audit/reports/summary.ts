/**
 * Figures and wording shared by the Word report and the PowerPoint summary,
 * so both always show the same overall rating, observation order and narrative.
 */
import type { QueryRow } from "../types";
import { auditTypeLabel, type ReportData } from "./types";

export type Rating = "High" | "Medium" | "Low";

export const RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
export const AGREEMENT: Record<string, string> = { agreed: "Agreed", partially_agreed: "Partially agreed", not_agreed: "Not agreed" };

// ---- Formatting ---------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const toDate = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00` : d);
/** 01-Apr-2026, as in the templates. */
export const dmy = (d: string | null | undefined) => {
  if (!d) return "—";
  const x = toDate(d);
  return `${String(x.getDate()).padStart(2, "0")}-${MONTHS[x.getMonth()]}-${x.getFullYear()}`;
};
/** 01-Apr-26 for summary tables. */
export const dmyShort = (d: string | null | undefined) => (d ? dmy(d).replace(/-(\d{2})(\d{2})$/, "-$2") : "—");
export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const resultText = (r: string | null | undefined) => (r === "pass" ? "Pass" : r === "fail" ? "Fail" : "Not tested");
export const ratingOf = (q: QueryRow) => cap(q.risk_rating ?? "low") as Rating;
export const statusOf = (q: QueryRow) =>
  q.query_status === "closed" ? `Closed (retested on ${dmy(q.closed_at)})` : q.retests.length ? "In progress" : "Open";

export function summarize(r: ReportData) {
  const e = r.engagement;
  const d = r.details;
  const s = r.summary;
  const reportTitle = `${auditTypeLabel(e.audit_type).replace(/ audit$/i, " Audit")} Report`; // "Internal Audit Report"
  const area = d.audit_area;

  // Observations: highest rating first, as the templates ask.
  const obs = [...r.queries].sort((a, b) => RANK[ratingOf(a)] - RANK[ratingOf(b)] || a.reference.localeCompare(b.reference));
  const counts: Record<Rating, number> = { High: 0, Medium: 0, Low: 0 };
  obs.forEach((q) => counts[ratingOf(q)]++);
  const overall: Rating = d.overall_rating || (counts.High ? "High" : counts.Medium ? "Medium" : "Low");
  const agreed = obs.filter((q) => q.management_agreement === "agreed").length;
  const cleanProcesses = r.processes.filter((x) => x.failed === 0).map((x) => x.name);

  const assessment = d.overall_assessment || [
    `Based on the testing performed, the control environment over ${area} at ${e.client.name} is rated ${overall} risk.`,
    `Of the ${plural(s.controls, "key control")} tested across ${plural(s.processes, "process", "processes")}, ${s.passed} operated effectively and ${plural(s.failed, "exception")} ${s.failed === 1 ? "was" : "were"} noted (${counts.High} High, ${counts.Medium} Medium, ${counts.Low} Low).`,
    obs.length
      ? (agreed === obs.length ? "Management has agreed to the action plan for all observations." : `Management has agreed to the action plan for ${agreed} of ${plural(obs.length, "observation")}.`)
      : "No exceptions were noted.",
  ].join(" ");

  const highlights = d.key_highlights.length ? d.key_highlights : [
    obs[0]
      ? `Most significant issue (${ratingOf(obs[0])}): ${obs[0].control_title} — ${obs[0].failure_reason}`
      : "No control exceptions were identified in the areas tested.",
    obs.length
      ? `${plural(s.queries_closed, "observation")} closed after retest; ${plural(s.queries_open, "observation")} open and due for retest on the agreed dates.`
      : `All ${plural(s.controls, "control")} tested operated effectively during the period.`,
    cleanProcesses.length
      ? `Positive practice: no exceptions noted in ${cleanProcesses.join(", ")}.`
      : `Testing covered ${plural(s.controls, "control")} across ${plural(s.processes, "process", "processes")}.`,
  ];

  const conclusion = d.conclusion || [
    obs.length === 0
      ? `Based on the work performed, internal controls over ${area} are adequately designed and operating effectively.`
      : overall === "High"
        ? `Based on the work performed, internal controls over ${area} require significant improvement in the areas noted above.`
        : `Based on the work performed, internal controls over ${area} are generally adequate, except for the observations noted above.`,
    obs.length ? `Key areas needing attention: ${obs.slice(0, 3).map((q) => lowerFirst(q.control_title ?? "")).join("; ")}.` : "",
    obs.length
      ? `${agreed === obs.length ? "Management has agreed to the action plan, and the" : "The"} status of open observations will be reviewed in the next quarterly audit and reported to the Audit Committee.`
      : "",
  ].filter(Boolean).join(" ");

  return { reportTitle, area, obs, counts, overall, agreed, cleanProcesses, assessment, highlights, conclusion };
}
