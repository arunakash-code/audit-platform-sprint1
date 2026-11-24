/**
 * PowerPoint summary, laid out to match the firm's "Internal_Audit_Summary" template (16:9, Calibri):
 * 1 Cover (navy) → 2 Scope and period of coverage (three numbered cards) → 3 Executive summary
 * (overall rating card + High/Medium/Low/Total tiles) → 4 Summary of observations (table, 5 rows per slide)
 * → 5 Key highlights → 6 Conclusion (navy, three cards).
 * Positions are taken from the template (points ÷ 72 = inches).
 */
import PptxGenJS from "pptxgenjs";
import { fileBase, type ReportData } from "./types";
import { dmy, dmyShort, plural, ratingOf, summarize } from "./summary";

const NAVY = "1F3864";
const NAVY_CARD = "2B4A80";
const CARD = "EEF2F8";
const SUBTLE = "8EA9DB"; // cover subtitle, card labels on navy
const ON_NAVY = "DCE6F2"; // body text on navy
const TEXT = "404040";
const GREY = "7F7F7F";
const DARK = "1A1A1A";
const RATING: Record<string, string> = { High: "C00000", Medium: "ED7D31", Low: "70AD47" };
const FONT = "Calibri";
const ROWS_PER_SLIDE = 5;

type Cell = PptxGenJS.TableCell;
const pt = (n: number) => n / 72; // template coordinates are in points

export async function downloadPptReport(r: ReportData) {
  const e = r.engagement;
  const d = r.details;
  const s = r.summary;
  const { reportTitle, area, obs, counts, overall, agreed, cleanProcesses, assessment, conclusion } = summarize(r);
  const footerText = `${reportTitle} — ${area}  |  Confidential`;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in = 960 × 540 pt, same as the template
  pptx.title = `${reportTitle} — Summary — ${e.client.name}`;
  pptx.company = r.firm;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };

  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "FFFFFF" },
    objects: [{ text: { text: footerText, options: { x: pt(43), y: pt(505), w: pt(700), h: pt(20), fontFace: FONT, fontSize: 9, color: GREY } } }],
    slideNumber: { x: pt(893), y: pt(504), w: pt(43), h: pt(22), fontFace: FONT, fontSize: 10, color: GREY, align: "right" },
  });

  const contentSlide = (title: string) => {
    const slide = pptx.addSlide({ masterName: "CONTENT" });
    slide.addText(title, { x: pt(43), y: pt(29), w: pt(871), h: pt(58), fontFace: FONT, fontSize: 36, bold: true, color: NAVY, valign: "middle", margin: 0 });
    return slide;
  };
  const bullets = (items: string[], color = TEXT, size = 15) =>
    items.map((t) => ({ text: t, options: { bullet: { indent: 18 }, color, fontSize: size, paraSpaceAfter: 6 } }));

  // ---- 1. Cover --------------------------------------------------------------------
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText(`${reportTitle} — Summary`, { x: pt(58), y: pt(166), w: pt(842), h: pt(86), fontFace: FONT, fontSize: 44, bold: true, color: "FFFFFF", valign: "bottom", margin: 0 });
  cover.addText(`${e.client.name}  |  ${area}`, { x: pt(58), y: pt(259), w: pt(842), h: pt(58), fontFace: FONT, fontSize: 22, color: SUBTLE, valign: "top", margin: 0 });
  cover.addText([
    { text: "Period of coverage: ", options: { bold: true } },
    { text: `${dmy(e.period_start)} to ${dmy(e.period_end)}`, options: { breakLine: true } },
    { text: "Report date: ", options: { bold: true } },
    { text: `${dmy(r.generated_at)}   |   Ref: ${d.reference_no}` },
  ], { x: pt(58), y: pt(403), w: pt(842), h: pt(65), fontFace: FONT, fontSize: 16, color: ON_NAVY, valign: "top", margin: 0 });

  // ---- 2. Scope and period of coverage -------------------------------------------------
  const scope = contentSlide("Scope and period of coverage");
  const cards: [string, string[]][] = [
    ["Objectives", d.objectives],
    ["Scope", [
      d.entity_locations || e.client.name,
      `Processes: ${r.processes.map((x) => x.name).join(", ")}`,
      `Out of scope: ${d.out_of_scope}`,
    ]],
    ["Period & approach", [
      `Coverage: ${dmy(e.period_start)} to ${dmy(e.period_end)}`,
      d.fieldwork_start ? `Fieldwork: ${dmy(d.fieldwork_start)} to ${dmy(d.fieldwork_end)}` : "Fieldwork: —",
      d.approach,
    ]],
  ];
  cards.forEach(([title, items], i) => {
    const x = [43, 338, 634][i];
    scope.addShape("roundRect", { x: pt(x), y: pt(115), w: pt(274), h: pt(353), fill: { color: CARD }, line: { color: CARD }, rectRadius: 0.08 });
    scope.addShape("ellipse", { x: pt(x + 25), y: pt(140), w: pt(43), h: pt(43), fill: { color: NAVY }, line: { color: NAVY } });
    scope.addText(String(i + 1), { x: pt(x + 25), y: pt(140), w: pt(43), h: pt(43), fontFace: FONT, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    scope.addText(title, { x: pt(x + 25), y: pt(198), w: pt(223), h: pt(36), fontFace: FONT, fontSize: 22, bold: true, color: NAVY, valign: "middle", margin: 0 });
    const long = items.join(" ").length > 260;
    scope.addText(bullets(items, TEXT, long ? 13 : 15), { x: pt(x + 25), y: pt(245), w: pt(230), h: pt(209), fontFace: FONT, valign: "top", margin: 0, fit: "shrink" });
  });

  // ---- 3. Executive summary ----------------------------------------------------------
  const exec = contentSlide("Executive summary");
  exec.addShape("roundRect", { x: pt(43), y: pt(115), w: pt(317), h: pt(353), fill: { color: NAVY }, line: { color: NAVY }, rectRadius: 0.08 });
  exec.addText("OVERALL RISK RATING", { x: pt(68), y: pt(140), w: pt(266), h: pt(29), fontFace: FONT, fontSize: 14, bold: true, color: SUBTLE, charSpacing: 3, margin: 0 });
  exec.addText(overall, { x: pt(68), y: pt(173), w: pt(266), h: pt(65), fontFace: FONT, fontSize: 26, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
  exec.addText(assessment, {
    x: pt(68), y: pt(252), w: pt(266), h: pt(194), fontFace: FONT, fontSize: assessment.length > 330 ? 13 : 15,
    color: ON_NAVY, valign: "top", margin: 0, fit: "shrink",
  });
  const tiles: [string, number, string][] = [
    ["High", counts.High, RATING.High], ["Medium", counts.Medium, RATING.Medium],
    ["Low", counts.Low, RATING.Low], ["Total", obs.length, NAVY],
  ];
  tiles.forEach(([label, value, color], i) => {
    const x = i % 2 === 0 ? 389 : 655;
    const y = i < 2 ? 115 : 295;
    exec.addShape("roundRect", { x: pt(x), y: pt(y), w: pt(245), h: pt(158), fill: { color: CARD }, line: { color: CARD }, rectRadius: 0.08 });
    exec.addShape("ellipse", { x: pt(x + 25), y: pt(y + 29), w: pt(22), h: pt(22), fill: { color }, line: { color } });
    exec.addText(label, { x: pt(x + 57), y: pt(y + 25), w: pt(166), h: pt(29), fontFace: FONT, fontSize: 16, bold: true, color: DARK, valign: "middle", margin: 0 });
    exec.addText(String(value), { x: pt(x + 25), y: pt(y + 65), w: pt(202), h: pt(72), fontFace: FONT, fontSize: 54, bold: true, color, valign: "middle", margin: 0 });
  });

  // ---- 4. Summary of observations (5 per slide, highest risk first) ----------------------
  const head = (t: string): Cell => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } });
  const pages = Math.max(1, Math.ceil(obs.length / ROWS_PER_SLIDE));
  for (let pg = 0; pg < pages; pg++) {
    const slide = contentSlide(pages > 1 && pg > 0 ? "Summary of observations (continued)" : "Summary of observations");
    const chunk = obs.slice(pg * ROWS_PER_SLIDE, (pg + 1) * ROWS_PER_SLIDE);
    if (!chunk.length) {
      slide.addText("No observations were raised — every control tested operated effectively.", { x: pt(43), y: pt(130), w: pt(871), h: pt(40), fontFace: FONT, fontSize: 18, color: TEXT, margin: 0 });
    } else {
      const rows: Cell[][] = [
        [head("#"), head("Observation"), head("Rating"), head("Responsible"), head("Target date")],
        ...chunk.map((q, i): Cell[] => {
          const rating = ratingOf(q);
          return [
            { text: String(pg * ROWS_PER_SLIDE + i + 1) },
            { text: q.control_title ?? q.reference },
            { text: rating, options: { bold: true, color: "FFFFFF", fill: { color: RATING[rating] }, align: "center" } },
            { text: q.responsible_person ?? "—" },
            { text: dmyShort(q.target_date) },
          ];
        }),
      ];
      slide.addTable(rows, {
        x: pt(43), y: pt(115), w: pt(871), colW: [0.6, 5.6, 1.5, 2.6, 1.8],
        rowH: pt(44.7), fontFace: FONT, fontSize: 15, color: DARK, valign: "middle", margin: [0.04, 0.12, 0.04, 0.12], // inches
        border: { type: "solid", color: "BFBFBF", pt: 0.75 }, autoPage: false,
      });
    }
    slide.addText("Observations listed in descending order of risk. Full details in the Internal Audit Report.", {
      x: pt(43), y: pt(432), w: pt(871), h: pt(29), fontFace: FONT, fontSize: 12, color: GREY, margin: 0,
    });
  }

  // ---- 5. Key highlights --------------------------------------------------------------
  const byProcess = new Map<string, number>();
  obs.forEach((q) => byProcess.set(q.process_name ?? "—", (byProcess.get(q.process_name ?? "—") ?? 0) + 1));
  const [topProcess, topCount] = [...byProcess.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const custom = d.key_highlights;
  const highlights: [string, string, string, string][] = [
    ["!", RATING.High, "Most significant issue", custom[0] ?? (obs[0]
      ? `${obs[0].control_title} — ${obs[0].failure_reason} (${ratingOf(obs[0])} risk: ${obs[0].risk_title?.toLowerCase()})`
      : "No control exceptions were identified in the areas tested.")],
    ["≡", RATING.Medium, "Recurring theme", custom[1] ?? (obs.length > 1
      ? `${topCount} of ${obs.length} observations relate to ${topProcess}; ${plural(s.queries_open, "observation")} still open and due for retest on the agreed dates.`
      : obs.length === 1 ? `A single observation, in ${obs[0].process_name}; due for retest from ${dmy(obs[0].target_date)}.` : "No recurring weaknesses were noted.")],
    ["✓", RATING.Low, "Good practices noted", custom[2] ?? (cleanProcesses.length
      ? `No exceptions noted in ${cleanProcesses.join(", ")}; ${s.passed} of ${s.controls} controls operated effectively.`
      : `${s.passed} of ${s.controls} controls tested operated effectively.`)],
  ];
  const hl = contentSlide("Key highlights");
  highlights.forEach(([icon, color, title, text], i) => {
    const y = [122, 238, 353][i];
    hl.addShape("ellipse", { x: pt(58), y: pt(y), w: pt(65), h: pt(65), fill: { color }, line: { color } });
    hl.addText(icon, { x: pt(58), y: pt(y), w: pt(65), h: pt(65), fontFace: FONT, fontSize: 28, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    hl.addText(title, { x: pt(144), y: pt(y - 1), w: pt(720), h: pt(32), fontFace: FONT, fontSize: 22, bold: true, color: NAVY, valign: "middle", margin: 0 });
    hl.addText(text, { x: pt(144), y: pt(y + 33), w: pt(760), h: pt(70), fontFace: FONT, fontSize: text.length > 170 ? 14 : 16, color: TEXT, valign: "top", margin: 0, fit: "shrink" });
  });

  // ---- 6. Conclusion ------------------------------------------------------------------
  const open = obs.filter((q) => q.query_status === "open").sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""));
  const close = pptx.addSlide();
  close.background = { color: NAVY };
  close.addText("Conclusion", { x: pt(58), y: pt(43), w: pt(842), h: pt(72), fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
  close.addText(conclusion, {
    x: pt(58), y: pt(130), w: pt(842), h: pt(130), fontFace: FONT, fontSize: conclusion.length > 300 ? 16 : conclusion.length > 180 ? 18 : 22,
    color: ON_NAVY, valign: "middle", margin: 0, fit: "shrink",
  });
  const closing: [string, string][] = [
    ["Management action", !obs.length ? "No corrective action required."
      : agreed === obs.length ? `Action plan agreed for all ${plural(obs.length, "observation")}.`
      : `Action plan agreed for ${agreed} of ${plural(obs.length, "observation")}; responses recorded for each.`],
    ["Follow-up", open.length
      ? `${plural(open.length, "open observation")} to be retested from ${dmy(open[0].target_date)}; status reviewed in the next quarterly audit.`
      : "All observations closed after retest; status confirmed in the next quarterly audit."],
    ["Reporting", `Report shared with ${d.distribution}.${d.exit_meeting_date ? ` Exit meeting held on ${dmy(d.exit_meeting_date)}.` : ""}`],
  ];
  closing.forEach(([title, text], i) => {
    const x = [58, 342, 626][i];
    close.addShape("roundRect", { x: pt(x), y: pt(274), w: pt(263), h: pt(173), fill: { color: NAVY_CARD }, line: { color: NAVY_CARD }, rectRadius: 0.08 });
    close.addText(title, { x: pt(x + 21), y: pt(295), w: pt(220), h: pt(36), fontFace: FONT, fontSize: 20, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
    close.addText(text, { x: pt(x + 21), y: pt(338), w: pt(225), h: pt(100), fontFace: FONT, fontSize: 15, color: ON_NAVY, valign: "top", margin: 0, fit: "shrink" });
  });

  await pptx.writeFile({ fileName: `${fileBase(r)}-summary.pptx` });
}
