/**
 * Detailed Word report, laid out to match the firm's "Internal Audit Report" template:
 * cover (reference table) → Contents → 1 Scope & Objectives → 2 Period of Coverage → 3 Risk Rating Methodology
 * → 4 Executive Summary → 5 Detailed Observations → 6 Conclusion & sign-off → Annexure A Abbreviations
 * → Annexure B Testing performed (landscape, every control and check).
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageBreak, PageNumber, PageOrientation,
  Paragraph, ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, VerticalAlign, WidthType,
} from "docx";
import { downloadBlob } from "../shared";
import { fileBase, type ReportData } from "./types";
import { AGREEMENT, cap, dmy, dmyShort, lowerFirst, plural, ratingOf, resultText, statusOf, summarize } from "./summary";

// ---- Template palette ---------------------------------------------------------
const NAVY = "1F3864";
const INK = "000000";
const GREY = "7F7F7F";
const LABEL_FILL = "F2F2F2";
const BORDER = "BFBFBF";
const RATING_FILL: Record<string, string> = { High: "C00000", Medium: "ED7D31", Low: "70AD47" };
const RATING_ACTION: Record<string, [string, string]> = {
  High: ["Significant control weakness or non-compliance that could lead to material financial loss, fraud, regulatory penalty or serious reputational damage.", "Immediate action; within 30 days"],
  Medium: ["Control weakness that could affect the achievement of process objectives or cause moderate financial or compliance exposure.", "Action within 60–90 days"],
  Low: ["Minor weakness or improvement opportunity with limited impact; good practice recommendation.", "Action within 90–180 days"],
};

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];
type RunOpts = { bold?: boolean; italics?: boolean; color?: string; size?: number };

// ---- Small builders -------------------------------------------------------------
const run = (text: string, o: RunOpts = {}) => new TextRun({ text, ...o });
const p = (children: string | TextRun[], o: { after?: number; before?: number; align?: Align; size?: number; color?: string; bold?: boolean; italics?: boolean } = {}) =>
  new Paragraph({
    alignment: o.align,
    spacing: { before: o.before ?? 0, after: o.after ?? 160 },
    children: typeof children === "string" ? [run(children, { size: o.size, color: o.color, bold: o.bold, italics: o.italics })] : children,
  });
const h1 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 360, after: 160 }, children: [run(text)] });
const h2 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 240, after: 120 }, children: [run(text)] });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [run(text)] });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });
const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [] });

const line = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
const borders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };

type CellOpts = { fill?: string; color?: string; bold?: boolean; italics?: boolean; align?: Align; width?: number; size?: number; edge?: string };
function cell(content: string | Paragraph[], o: CellOpts = {}) {
  const children = typeof content === "string"
    ? content.split("\n").map((t, i, all) => new Paragraph({
        alignment: o.align,
        // Header cells pad with paragraph spacing instead of cell margins (renders the same in Word, WPS and Google Docs).
        spacing: o.edge ? { before: i === 0 ? 80 : 0, after: i === all.length - 1 ? 80 : 60 } : { after: i === all.length - 1 ? 0 : 60 },
        children: [run(t, { bold: o.bold, italics: o.italics, color: o.color, size: o.size ?? 20 })],
      }))
    : content;
  return new TableCell({
    children,
    verticalAlign: VerticalAlign.CENTER,
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    margins: { top: o.edge ? 0 : 80, bottom: o.edge ? 0 : 80, left: 120, right: 120 },
    // Coloured cells draw their top/bottom edges in their own colour, so the light-grey table
    // border doesn't show as a pale stripe under a dark header row.
    borders: o.edge
      ? { top: { style: BorderStyle.SINGLE, size: 4, color: o.edge }, bottom: { style: BorderStyle.SINGLE, size: 4, color: o.edge } }
      : undefined,
  });
}
const headCell = (t: string, width?: number, align?: Align) => cell(t, { fill: NAVY, color: "FFFFFF", bold: true, width, align, edge: NAVY });
const labelCell = (t: string, width = 28) => cell(t, { fill: LABEL_FILL, bold: true, width });
const ratingCell = (rating: string, o: { width?: number; align?: Align } = {}) => {
  const fill = RATING_FILL[rating] ?? GREY;
  return cell(rating, { fill, color: "FFFFFF", bold: true, edge: fill, ...o });
};

const table = (rows: TableRow[]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows });
const headerRow = (labels: string[], widths?: number[], align?: Align) =>
  new TableRow({ tableHeader: true, children: labels.map((l, i) => headCell(l, widths?.[i], align)) });
const row = (cells: TableCell[]) => new TableRow({ cantSplit: true, children: cells });
const kv = (rows: [string, string | TableCell][], labelWidth = 28) =>
  table(rows.map(([k, v]) => row([labelCell(k, labelWidth), typeof v === "string" ? cell(v, { width: 100 - labelWidth }) : v])));

// ---- Report -------------------------------------------------------------------
export async function downloadWordReport(r: ReportData) {
  const e = r.engagement;
  const d = r.details;
  const { reportTitle, area, obs, counts, overall, assessment, highlights, conclusion } = summarize(r);

  const header = new Header({
    children: [p([run(`${reportTitle} — ${area}  |  Confidential`, { color: GREY, size: 16 })], { align: AlignmentType.RIGHT, after: 0 })],
  });
  const footer = new Footer({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], color: GREY, size: 16 })] })],
  });

  const body: (Paragraph | Table | TableOfContents)[] = [];

  // ---- Cover --------------------------------------------------------------------
  body.push(
    new Paragraph({ spacing: { before: 2600, after: 80 }, children: [run(e.client.name.toUpperCase(), { bold: true, color: GREY, size: 28 })] }),
    new Paragraph({ spacing: { after: 80 }, children: [run(reportTitle, { bold: true, color: NAVY, size: 52 })] }),
    new Paragraph({ spacing: { after: 480 }, children: [run(area, { color: NAVY, size: 32 })] }),
    kv([
      ["Report Reference No.", d.reference_no],
      ["Period of Coverage", `${dmy(e.period_start)} to ${dmy(e.period_end)}`],
      ["Audit Fieldwork Dates", d.fieldwork_start ? `${dmy(d.fieldwork_start)} to ${dmy(d.fieldwork_end)}` : "—"],
      ["Report Date", dmy(r.generated_at)],
      ["Overall Risk Rating", overall],
      ["Report Status", d.report_status],
      ["Prepared By", `${d.prepared_by}, ${d.prepared_by_designation}`],
      ["Reviewed By", `${d.reviewed_by}, ${d.reviewed_by_designation}`],
    ], 33),
    p([run("Distribution: ", { bold: true }), run(d.distribution)], { before: 240, after: 80 }),
    p("Confidential — for internal use only.", { italics: true, color: GREY, size: 18 }),
    pageBreak(),
  );

  // ---- Contents -------------------------------------------------------------------
  body.push(
    h1("Contents"),
    new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
    p("Right-click the table above and choose Update Field to refresh page numbers.", { italics: true, color: GREY, size: 18, before: 200 }),
    pageBreak(),
  );

  // ---- 1. Scope and objectives --------------------------------------------------------
  body.push(
    h1("1. Audit Scope and Objectives"),
    h2("1.1 Objectives"),
    p("The objectives of this audit were to:", { after: 80 }),
    ...d.objectives.map(bullet),
    h2("1.2 Scope"),
    table([
      headerRow(["Item", "Details"], [33, 67]),
      row([cell("Entity / Location(s)", { width: 33 }), cell(d.entity_locations || e.client.name, { width: 67 })]),
      row([cell("Processes in scope"), cell(r.processes.map((x) => x.name).join(", "))]),
      row([cell("Out of scope"), cell(d.out_of_scope)]),
      row([cell("Approach"), cell(d.approach)]),
      row([cell("Sampling basis"), cell(d.sampling_basis)]),
    ]),
    h2("1.3 Limitations"),
    p(d.limitations),

    h1("2. Period of Coverage"),
    p([
      run(`The audit covered transactions and activities for the period ${dmy(e.period_start)} to ${dmy(e.period_end)}. `),
      run(d.fieldwork_start ? `Fieldwork was carried out from ${dmy(d.fieldwork_start)} to ${dmy(d.fieldwork_end)}. ` : ""),
      run(d.exit_meeting_date ? `The exit meeting with management was held on ${dmy(d.exit_meeting_date)}.` : ""),
    ]),

    h1("3. Risk Rating Methodology"),
    p("Each observation is rated on its potential impact and likelihood, as defined below."),
    table([
      headerRow(["Rating", "Definition", "Expected action"], [16, 58, 26]),
      ...(["High", "Medium", "Low"] as const).map((k) => row([
        ratingCell(k, { width: 16, align: AlignmentType.CENTER }),
        cell(RATING_ACTION[k][0], { width: 58 }),
        cell(RATING_ACTION[k][1], { width: 26 }),
      ])),
    ]),
    p([
      run("Overall report rating: ", { bold: true }),
      run("High if any High-rated observation exists or several Medium observations together indicate a significant weakness; Medium if Medium observations exist without a High; otherwise Low."),
    ], { before: 200 }),
  );

  // ---- 4. Executive summary ----------------------------------------------------------
  body.push(
    h1("4. Executive Summary"),
    h2("4.1 Overall Assessment"),
    p([run("Overall Risk Rating: ", { bold: true }), run(overall, { bold: true, color: RATING_FILL[overall] })], { after: 100 }),
    p(assessment),
    h2("4.2 Observations by Risk Rating"),
    table([
      headerRow(["High", "Medium", "Low", "Total"], [25, 25, 25, 25]),
      row([counts.High, counts.Medium, counts.Low, obs.length].map((n) => cell(String(n), { align: AlignmentType.CENTER, width: 25 }))),
    ]),
    h2("4.3 Summary of Observations"),
    obs.length
      ? table([
          headerRow(["#", "Observation", "Rating", "Responsible", "Target Date"], [6, 42, 14, 21, 17]),
          ...obs.map((q, i) => row([
            cell(String(i + 1), { width: 6 }),
            cell(q.control_title ?? q.reference, { width: 42 }),
            ratingCell(ratingOf(q), { width: 14, align: AlignmentType.CENTER }),
            cell(q.responsible_person ?? "—", { width: 21 }),
            cell(dmyShort(q.target_date), { width: 17 }),
          ])),
        ])
      : p("No observations were raised.", { italics: true }),
    h2("4.4 Key Highlights"),
    ...highlights.map(bullet),
  );

  // ---- 5. Detailed observations ----------------------------------------------------------
  body.push(pageBreak(), h1("5. Detailed Observations"));
  if (!obs.length) body.push(p("No exceptions were noted during testing."));
  obs.forEach((q, i) => {
    const rating = ratingOf(q);
    const sample = q.population != null ? `${q.sample_size} of ${q.population}` : `${q.sample_size}`;
    const response = [q.management_agreement ? AGREEMENT[q.management_agreement] : null, q.management_response].filter(Boolean).join(" — ");
    const retests = q.retests.length
      ? "\n" + q.retests.map((t) => `Retest ${dmy(t.at)} by ${t.by}: ${t.result === "pass" ? "passed" : "failed"} — ${t.notes}`).join("\n")
      : "";
    body.push(
      h2(`Observation ${i + 1}: ${q.control_title ?? q.reference}`),
      table([
        row([labelCell("Risk Rating"), ratingCell(rating, { width: 72 })]),
        row([labelCell("Process / Area"), cell(`${q.process_name ?? "—"} → ${q.control_code ?? q.reference}`, { width: 72 })]),
        row([labelCell("Background"), cell(
          `${q.control_code ?? ""} — ${q.control_title ?? ""}.${q.control_description ? ` ${q.control_description}` : ""} ` +
          `Sample tested: ${sample} items. Query reference ${q.reference}.`, { width: 72 })]),
        row([labelCell("Issue / Finding"), cell(`${q.failure_reason ?? "—"}\nExceptions: ${q.failed_samples} of ${q.sample_size} samples tested.`, { width: 72 })]),
        row([labelCell("Risk / Impact"), cell(q.risk_description || `Risk that ${lowerFirst(q.risk_title ?? "the control objective is not met")}.`, { width: 72 })]),
        row([labelCell("Recommendation"), cell(q.recommendation || `Ensure the control "${q.control_title}" operates consistently as designed, and remediate the ${plural(q.failed_samples ?? 0, "exception")} identified.`, { width: 72 })]),
        row([labelCell("Management Response"), cell(response || "—", { width: 72 })]),
        row([labelCell("Responsible Person"), cell(q.responsible_person ?? "—", { width: 72 })]),
        row([labelCell("Timeline (Target Date)"), cell(dmy(q.target_date), { width: 72 })]),
        row([labelCell("Status"), cell(statusOf(q) + retests, { width: 72 })]),
      ]),
      spacer(),
    );
  });

  // ---- 6. Conclusion + sign-off ------------------------------------------------------
  body.push(
    h1("6. Conclusion"),
    p(conclusion),
    p(`We thank the management and staff of ${d.department} for their cooperation during the audit.`, { after: 240 }),
    table([
      row([cell("Prepared by", { fill: LABEL_FILL, bold: true, width: 50 }), cell("Reviewed & approved by", { fill: LABEL_FILL, bold: true, width: 50 })]),
      row([cell(d.prepared_by), cell(d.reviewed_by)]),
      row([cell(d.prepared_by_designation), cell(d.reviewed_by_designation)]),
      row([cell("Signature: ______________"), cell("Signature: ______________")]),
      row([cell("Date:"), cell("Date:")]),
    ]),

    h1("Annexure A: Abbreviations"),
    table([
      headerRow(["Abbreviation", "Meaning"], [25, 75]),
      ...d.abbreviations.map((a) => row([cell(a.abbr, { width: 25 }), cell(a.meaning, { width: 75 })])),
    ]),
  );

  // ---- Annexure B (landscape): every control and check tested -------------------------
  const annex: (Paragraph | Table)[] = [h1("Annexure B: Testing Performed")];
  r.processes.forEach((proc) => {
    annex.push(h2(`${proc.name}${proc.assignee ? ` — tested by ${proc.assignee}` : ""}`));
    const rows: TableRow[] = [headerRow(["Risk", "Control", "Checks performed", "Population", "Sample", "Result", "Notes"], [16, 20, 28, 8, 7, 7, 14])];
    proc.risks.forEach((risk) => risk.controls.forEach((c) => {
      const checks = c.snapshot.checks.flatMap((k) => {
        const cr = c.check_results[k.id];
        const mark = cr?.result === "pass" ? "✓" : cr?.result === "fail" ? "✗" : "–";
        const figures = cr?.result ? ` (${cr.sample_size ?? "—"} of ${cr.population ?? "—"} · ${resultText(cr.result)})` : cr?.notes ? " (Not tested)" : "";
        const out = [new Paragraph({
          spacing: { after: cr?.notes ? 0 : 40 },
          children: [run(`${mark} ${k.description}${figures}`, { size: 16, color: cr?.result === "fail" ? RATING_FILL.High : cr?.result ? INK : GREY })],
        })];
        if (cr?.notes) out.push(new Paragraph({ spacing: { after: 40 }, children: [run(`   ${cr.notes}`, { size: 15, color: GREY, italics: true })] }));
        return out;
      });
      rows.push(row([
        cell(`${risk.code ?? ""} ${risk.title}\n(${cap(risk.rating)} risk)`, { size: 16 }),
        cell(`${c.snapshot.control_code ?? ""} ${c.snapshot.control_title}`, { size: 16 }),
        checks.length ? cell(checks) : cell("—", { size: 16 }),
        cell(c.population == null ? "—" : String(c.population), { size: 16 }),
        cell(c.sample_size == null ? "—" : String(c.sample_size), { size: 16 }),
        c.result === "fail"
          ? cell(`Fail\n${c.reference}`, { size: 16, bold: true, color: RATING_FILL.High })
          : cell(resultText(c.result), { size: 16 }),
        cell(c.result === "fail" ? (c.failure_reason ?? "") : (c.test_notes ?? ""), { size: 16 }),
      ]));
    }));
    annex.push(table(rows));
  });

  const doc = new Document({
    creator: r.firm,
    title: `${reportTitle} — ${e.client.name}`,
    features: { updateFields: true }, // Word fills the Contents page numbers when the file is opened
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: INK } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Calibri", size: 32, bold: true, color: NAVY } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Calibri", size: 24, bold: true, color: NAVY } },
      ],
    },
    sections: [
      { headers: { default: header }, footers: { default: footer }, children: body },
      { properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } }, headers: { default: header }, footers: { default: footer }, children: annex },
    ],
  });

  downloadBlob(await Packer.toBlob(doc), `${fileBase(r)}-detailed-report.docx`);
}
