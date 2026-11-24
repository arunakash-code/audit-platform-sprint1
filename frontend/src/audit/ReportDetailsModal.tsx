import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiError, type ValidationErrors } from "../lib/api";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../components/ui";
import type { ReportDetails } from "./reports/types";

/**
 * Step IV — the details printed on the Word report (cover page, scope, sign-off).
 * Every field starts from a sensible default; leave the narrative boxes empty to have the report write them.
 */
export function ReportDetailsModal({ open, onClose, engagementId, details }: { open: boolean; onClose: () => void; engagementId: number; details: ReportDetails }) {
  const qc = useQueryClient();
  const toForm = (d: ReportDetails) => ({
    ...d,
    fieldwork_start: d.fieldwork_start ?? "",
    fieldwork_end: d.fieldwork_end ?? "",
    exit_meeting_date: d.exit_meeting_date ?? "",
    overall_assessment: d.overall_assessment ?? "",
    conclusion: d.conclusion ?? "",
    objectives: d.objectives.join("\n"),
    key_highlights: d.key_highlights.join("\n"),
    abbreviations: d.abbreviations.map((a) => `${a.abbr} = ${a.meaning}`).join("\n"),
  });
  const [form, setForm] = useState(() => toForm(details));
  const [wasOpen, setWasOpen] = useState(open);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [error, setError] = useState("");
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setForm(toForm(details)); setErrors({}); setError(""); }
  }

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => api.put(`/audit/engagements/${engagementId}/report-details`, {
      ...form,
      objectives: lines(form.objectives),
      key_highlights: lines(form.key_highlights),
      abbreviations: lines(form.abbreviations).map((l) => {
        const [abbr, ...rest] = l.split("=");
        return { abbr: abbr.trim(), meaning: rest.join("=").trim() || abbr.trim() };
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audit", "engagement"] }); onClose(); },
    onError: (e) => { const x = apiError(e); setErrors(x.errors); setError(x.message); },
  });

  const f = <K extends keyof typeof form>(k: K) => ({ value: form[k] as string, onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });
  const err = (k: string) => errors[k]?.[0] ?? Object.entries(errors).find(([key]) => key.startsWith(`${k}.`))?.[1][0];

  return (
    <Modal open={open} onClose={onClose} title="Report details" wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        <p className="text-sm text-muted">These appear on the Word report. Defaults are filled in for you; clear a box to go back to its default.</p>
        {error && !Object.keys(errors).length && <Alert>{error}</Alert>}

        <Group title="Cover page">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Report reference no." error={err("reference_no")}><Input {...f("reference_no")} /></Field>
            <Field label="Report status"><Select {...f("report_status")}><option>Final</option><option>Draft</option></Select></Field>
            <Field label="Audit area / department / process" className="sm:col-span-2" error={err("audit_area")}><Input {...f("audit_area")} /></Field>
            <Field label="Fieldwork from" error={err("fieldwork_start")}><Input type="date" {...f("fieldwork_start")} /></Field>
            <Field label="Fieldwork to" error={err("fieldwork_end")}><Input type="date" {...f("fieldwork_end")} /></Field>
            <Field label="Overall risk rating" hint="Automatic: High if any High observation, else Medium if any Medium, else Low.">
              <Select {...f("overall_rating")}><option value="">Automatic</option><option>High</option><option>Medium</option><option>Low</option></Select>
            </Field>
            <Field label="Exit meeting date" error={err("exit_meeting_date")}><Input type="date" {...f("exit_meeting_date")} /></Field>
            <Field label="Prepared by"><Input {...f("prepared_by")} /></Field>
            <Field label="Designation"><Input {...f("prepared_by_designation")} /></Field>
            <Field label="Reviewed by"><Input {...f("reviewed_by")} /></Field>
            <Field label="Designation"><Input {...f("reviewed_by_designation")} /></Field>
            <Field label="Distribution" className="sm:col-span-2"><Input {...f("distribution")} /></Field>
          </div>
        </Group>

        <Group title="1. Scope and objectives">
          <Field label="Objectives (one per line)" error={err("objectives")}><Textarea rows={3} {...f("objectives")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entity / location(s)"><Input {...f("entity_locations")} /></Field>
            <Field label="Out of scope"><Input {...f("out_of_scope")} /></Field>
            <Field label="Approach"><Textarea rows={2} {...f("approach")} /></Field>
            <Field label="Sampling basis"><Textarea rows={2} {...f("sampling_basis")} /></Field>
          </div>
          <Field label="Limitations"><Input {...f("limitations")} /></Field>
        </Group>

        <Group title="4–6. Summary and conclusion">
          <Field label="Overall assessment" hint="Leave empty to have the report write it from the results."><Textarea rows={3} {...f("overall_assessment")} /></Field>
          <Field label="Key highlights (one per line)" hint="Leave empty to have the report write them."><Textarea rows={3} {...f("key_highlights")} /></Field>
          <Field label="Conclusion" hint="Leave empty to have the report write it."><Textarea rows={3} {...f("conclusion")} /></Field>
          <Field label="Department thanked"><Input {...f("department")} /></Field>
        </Group>

        <Group title="Annexure A: Abbreviations">
          <Field label="One per line, as ABBR = Meaning" error={err("abbreviations")}><Textarea rows={5} {...f("abbreviations")} /></Field>
        </Group>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-white pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save details</Button>
        </div>
      </form>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}
