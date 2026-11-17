import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageBreak, PageNumber, PageOrientation,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { downloadBlob } from "../shared";
import { auditTypeLabel, fileBase, longDate, type ReportData } from "./types";

const INK = "14161A";
const MUTED = "5D6370";
const ACCENT = "1F6F5C";
const LINE = "D9D6CC";
const HEAD_FILL = "EFEDE6";
const RED = "B42318";

const run = (text: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) => new TextRun({ text, ...o });
const para = (text: string | TextRun[], o: { bold?: boolean; color?: string; size?: number; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({
    alignment: o.align,
    spacing: { after: o.after ?? 120 },
    children: typeof text === "string" ? [run(text, { bold: o.bold, color: o.color, size: o.size })] : text,
  });
const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) =>
  new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [run(text)] });

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function cell(content: string | Paragraph[], o: { header?: boolean; width?: number; color?: string; bold?: boolean; size?: number } = {}) {
  const children = typeof content === "string"
    ? content.split("\n").map((line) => new Paragraph({ spacing: { after: 40 }, children: [run(line, { bold: o.header || o.bold, color: o.color, size: o.size ?? 18 })] }))
    : content;
  return new TableCell({
    children,
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.header ? { type: ShadingType.CLEAR, color: "auto", fill: HEAD_FILL } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function table(headers: string[], rows: (string | Paragraph[])[][], widths?: number[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { header: true, width: widths?.[i] })) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, { width: widths?.[i] })) })),
    ],
  });
}

/** Two-column label/value table, used for each observation. */
function keyValue(rows: [string, string, string?][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: rows.map(([k, v, color]) => new TableRow({ cantSplit: true, children: [cell(k, { header: true, width: 28 }), cell(v, { width: 72, color })] })),
  });
}

const resultText = (r: string | null) => (r === "pass" ? "Pass" : r === "fail" ? "Fail" : "Not tested");

export async function downloadWordReport(r: ReportData) {
  const e = r.engagement;
  const s = r.summary;
  const type = auditTypeLabel(e.audit_type);
  const periodText = `${e.period === "FY" ? e.fy_label : `${e.fy_label} ${e.period}`} (${longDate(e.period_start)} to ${longDate(e.period_end)})`;

  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        run(`${e.client.name} · ${type} · ${periodText.split(" (")[0]}    `, { color: MUTED, size: 16 }),
        new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], color: MUTED, size: 16 }),
      ],
    })],
  });
  const header = new Header({ children: [para([run(r.firm, { color: MUTED, size: 16 }), run("  ·  Confidential", { color: MUTED, size: 16 })], { align: AlignmentType.RIGHT })] });

  // ---- Cover + summary -------------------------------------------------------
  const main: (Paragraph | Table)[] = [
    new Paragraph({ spacing: { before: 2400, after: 120 }, children: [run(r.firm.toUpperCase(), { color: ACCENT, size: 20, bold: true })] }),
    new Paragraph({ spacing: { after: 120 }, children: [run(`${type} report`, { size: 56, bold: true, color: INK })] }),
    para(e.client.name, { size: 32, color: INK, after: 60 }),
    para(periodText, { size: 22, color: MUTED, after: 600 }),
    para([run("Report date: ", { color: MUTED, size: 20 }), run(longDate(r.generated_at), { size: 20 })], { after: 40 }),
    para([run("Prepared by: ", { color: MUTED, size: 20 }), run(r.generated_by, { size: 20 })], { after: 40 }),
    new Paragraph({ children: [new PageBreak()] }),

    heading("1. Executive summary"),
    para(
      `We tested the design and operating effectiveness of key controls across ${s.processes} process${s.processes === 1 ? "" : "es"} at ${e.client.name} for ${periodText}. ` +
      `Of the ${s.controls} controls tested, ${s.passed} operated effectively and ${s.failed} exception${s.failed === 1 ? " was" : "s were"} noted. ` +
      (s.failed ? `${s.queries_closed} of these ${s.queries_closed === 1 ? "has" : "have"} since been remediated and retested; ${s.queries_open} remain${s.queries_open === 1 ? "s" : ""} open.` : "No exceptions were noted."),
    ),
    table(["Measure", "Result"], [
      ["Processes reviewed", String(s.processes)],
      ["Controls tested", String(s.controls)],
      ["Controls operating effectively", `${s.passed} (${s.controls ? Math.round((s.passed / s.controls) * 100) : 0}%)`],
      ["Exceptions noted", String(s.failed)],
      ["Exceptions closed after retest", String(s.queries_closed)],
      ["Exceptions open", String(s.queries_open)],
    ], [60, 40]),
    para("", { after: 120 }),
    para("Exceptions by risk rating", { bold: true, after: 80 }),
    table(["High", "Medium", "Low"], [[String(s.failed_by_rating.high), String(s.failed_by_rating.medium), String(s.failed_by_rating.low)]]),

    heading("2. Scope and results by process"),
    table(
      ["Process", "Tested by", "Controls", "Passed", "Failed", "Completed"],
      r.processes.map((p) => [p.name, p.assignee ?? "—", String(p.controls), String(p.passed), String(p.failed), longDate(p.completed_at)]),
      [30, 18, 12, 12, 12, 16],
    ),

    heading("3. Detailed observations"),
  ];

  if (!r.queries.length) {
    main.push(para("No exceptions were noted during testing."));
  } else {
    r.queries.forEach((q, i) => {
      main.push(heading(`3.${i + 1}  ${q.reference} — ${q.control_title}`, HeadingLevel.HEADING_2));
      const retests = q.retests.length
        ? q.retests.map((t) => `${longDate(t.at)} · ${t.by} · ${t.result === "pass" ? "Passed" : "Failed"} — ${t.notes}`).join("\n")
        : "Not yet retested";
      main.push(keyValue([
        ["Process", q.process_name ?? "—"],
        ["Risk", `${q.risk_title} (${q.risk_rating ?? "—"} risk)`],
        ["Control", `${q.control_code ?? ""} ${q.control_title ?? ""}`.trim()],
        ["Samples", `${q.failed_samples} of ${q.sample_size} samples failed`],
        ["Observation", q.failure_reason ?? "—"],
        ["Management response", q.management_response ?? "—"],
        ["Person responsible", q.responsible_person ?? "—"],
        ["Timeline for closure", longDate(q.target_date)],
        ["Status", q.query_status === "closed" ? `Closed on ${longDate(q.closed_at)}` : "Open", q.query_status === "open" ? RED : ACCENT],
        ["Retest history", retests],
      ]));
      main.push(para("", { after: 120 }));
    });
  }

  // ---- Annexure (landscape): every control tested ---------------------------
  const annex: (Paragraph | Table)[] = [heading("Annexure — testing performed")];
  r.processes.forEach((p) => {
    annex.push(heading(`${p.name}${p.assignee ? ` — tested by ${p.assignee}` : ""}`, HeadingLevel.HEADING_2));
    const rows: (string | Paragraph[])[][] = [];
    p.risks.forEach((risk) => risk.controls.forEach((c) => {
      const checks = c.snapshot.checks.flatMap((k) => {
        const cr = c.check_results[k.id];
        const mark = cr?.result === "pass" ? "✓" : cr?.result === "fail" ? "✗" : "–";
        const figures = cr?.result ? ` (${cr.sample_size ?? "—"} of ${cr.population ?? "—"} · ${resultText(cr.result)})` : "";
        const lines = [new Paragraph({
          spacing: { after: cr?.notes ? 0 : 30 },
          children: [run(`${mark} ${k.description}${figures}`, { size: 16, color: cr?.result === "fail" ? RED : cr?.result ? INK : MUTED })],
        })];
        if (cr?.notes) lines.push(new Paragraph({ spacing: { after: 30 }, children: [run(`   ${cr.notes}`, { size: 15, color: MUTED, italics: true })] }));
        return lines;
      });
      rows.push([
        `${risk.code ?? ""} ${risk.title}\n(${risk.rating} risk)`,
        `${c.snapshot.control_code ?? ""} ${c.snapshot.control_title}`,
        checks.length ? checks : "—",
        c.population === null ? "—" : String(c.population),
        c.sample_size === null ? "—" : String(c.sample_size),
        resultText(c.result) + (c.result === "fail" ? `\n${c.reference}` : ""),
        c.result === "fail" ? (c.failure_reason ?? "") : (c.test_notes ?? ""),
      ]);
    }));
    annex.push(table(["Risk", "Control", "Checks performed", "Population", "Sample", "Result", "Notes"], rows, [16, 20, 28, 8, 7, 7, 14]));
  });

  const doc = new Document({
    creator: r.firm,
    title: `${type} report — ${e.client.name}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 20, color: INK } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 30, bold: true, color: INK } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 22, bold: true, color: ACCENT } },
      ],
    },
    sections: [
      { headers: { default: header }, footers: { default: footer }, children: main },
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
        headers: { default: header },
        footers: { default: footer },
        children: annex,
      },
    ],
  });

  downloadBlob(await Packer.toBlob(doc), `${fileBase(r)}-detailed-report.docx`);
}
