import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, FileText, Lock, Pencil, Plus, Presentation, Settings2, Trash2 } from "lucide-react";
import { api, apiError } from "../lib/api";
import { Alert, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select, cx } from "../components/ui";
import type { Engagement, EngagementProcess, Meta } from "./types";
import { EngagementModal } from "./Engagements";
import { ProgressLegend, Stat, StatusBadge, TestProgress, fmtDate, useMeta } from "./shared";
import type { ReportData, ReportDetails } from "./reports/types";
import { ReportDetailsModal } from "./ReportDetailsModal";

type Detail = {
  engagement: Engagement;
  processes: EngagementProcess[];
  summary: { processes: number; processes_completed: number; controls: number; tested: number; passed: number; failed: number; open_queries: number };
  can_manage: boolean;
  report_ready: boolean;
  report_details: ReportDetails;
};

export default function EngagementDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["audit", "engagement", id],
    queryFn: async () => (await api.get<{ data: Detail }>(`/audit/engagements/${id}`)).data.data,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["audit"] });
  const assign = useMutation({
    mutationFn: ({ ep, patch }: { ep: EngagementProcess; patch: { assigned_to?: number | null; due_date?: string | null } }) =>
      api.put(`/audit/engagement-processes/${ep.id}`, { assigned_to: ep.assignee?.id ?? null, due_date: ep.due_date, ...patch }),
    onSuccess: refresh,
    onError: (e) => setError(apiError(e).message),
  });
  const remove = useMutation({
    mutationFn: (ep: EngagementProcess) => api.delete(`/audit/engagement-processes/${ep.id}`),
    onSuccess: refresh,
    onError: (e) => setError(apiError(e).message),
  });
  const destroy = useMutation({
    mutationFn: () => api.delete(`/audit/engagements/${id}`),
    onSuccess: () => { refresh(); navigate("/app/engagements"); },
    onError: (e) => setError(apiError(e).message),
  });

  if (isLoading || !data) return <LoadingBlock />;
  const { engagement: e, processes, summary: s, can_manage } = data;
  const allAssigned = processes.length > 0 && processes.every((p) => p.assignee);

  const steps = [
    { n: "I", label: "Client & period", done: true },
    { n: "II", label: "Processes & team", done: allAssigned },
    { n: "III", label: "Control testing", done: processes.length > 0 && s.tested === s.controls },
    { n: "IV", label: "Reports", done: false },
  ];

  return (
    <>
      <Link to="/app/engagements" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" /> Engagements</Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{e.client?.name}</h1>
            <StatusBadge status={e.status} />
          </div>
          <p className="mt-1 text-sm text-ink-2">{e.label} · <span className="capitalize">{e.frequency}</span></p>
          <p className="text-xs text-muted">{fmtDate(e.period_start)} – {fmtDate(e.period_end)}</p>
        </div>
        {can_manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit</Button>
            {s.tested === 0 && <Button variant="ghost" size="sm" onClick={() => confirm("Delete this engagement?") && destroy.mutate()}><Trash2 className="size-3.5" /> Delete</Button>}
          </div>
        )}
      </div>

      <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((st) => (
          <li key={st.n} className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", st.done ? "border-accent/30 bg-accent-soft/60 text-accent-2" : "border-line bg-white text-ink-2")}>
            {st.done ? <CheckCircle2 className="size-4 shrink-0" /> : <span className="grid size-4 shrink-0 place-items-center font-mono text-[10px] text-muted">{st.n}</span>}
            {st.label}
          </li>
        ))}
      </ol>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Processes complete" value={`${s.processes_completed}/${s.processes}`} />
        <Stat label="Controls tested" value={`${s.tested}/${s.controls}`} sub={s.controls ? `${Math.round((s.tested / s.controls) * 100)}%` : undefined} />
        <Stat label="Failed controls" value={s.failed} tone={s.failed ? "red" : undefined} />
        <Stat label="Open queries" value={s.open_queries} tone={s.open_queries ? "amber" : undefined} />
      </div>

      {/* Step II */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="font-semibold">Processes in scope</h2>
            <p className="text-xs text-muted">Each process is tested by the person assigned to it.</p>
          </div>
          <div className="flex items-center gap-4">
            <ProgressLegend />
            {can_manage && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add processes</Button>}
          </div>
        </div>
        {!processes.length ? (
          <EmptyState title="No processes chosen yet" body="Pick the processes to review in this period and assign a team member to each." action={can_manage && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add processes</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Process</th>
                  <th className="px-3 py-2.5 font-medium">Assigned to</th>
                  <th className="px-3 py-2.5 font-medium">Due</th>
                  <th className="w-[22%] px-3 py-2.5 font-medium">Controls</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {processes.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3">
                      <Link to={`/app/testing/${p.id}`} className="font-medium hover:text-accent">{p.process_name}</Link>
                      <p className="font-mono text-[11px] text-muted">{p.process_code}</p>
                    </td>
                    <td className="px-3 py-3">
                      {can_manage && meta ? (
                        <Select aria-label={`Assign ${p.process_name}`} value={p.assignee?.id ?? ""} className="h-8 w-44 text-xs"
                          onChange={(ev) => assign.mutate({ ep: p, patch: { assigned_to: ev.target.value ? Number(ev.target.value) : null } })}>
                          <option value="">Unassigned</option>
                          {meta.testers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                      ) : (p.assignee?.name ?? <span className="text-muted">Unassigned</span>)}
                    </td>
                    <td className="px-3 py-3">
                      {can_manage ? (
                        <DueInput key={p.due_date ?? ""} label={`Due date for ${p.process_name}`} value={p.due_date}
                          onCommit={(v) => assign.mutate({ ep: p, patch: { due_date: v } })} />
                      ) : <span className="text-xs text-muted">{fmtDate(p.due_date)}</span>}
                    </td>
                    <td className="px-3 py-3"><div className="flex items-center gap-2"><TestProgress counts={p.counts} /><span className="shrink-0 text-xs tabular-nums text-muted">{p.counts.tested}/{p.counts.total}</span></div></td>
                    <td className="px-3 py-3"><StatusBadge status={p.status} />{p.counts.failed > 0 && <span className="ml-1.5 text-xs text-danger">{p.counts.failed} failed</span>}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <Link to={`/app/testing/${p.id}`} className="text-xs font-medium text-accent">{p.status === "completed" ? "View" : "Test"} →</Link>
                      {can_manage && p.counts.tested === 0 && (
                        <button onClick={() => confirm(`Remove ${p.process_name} from this engagement?`) && remove.mutate(p)} className="ml-3 rounded p-1 text-muted hover:text-danger" aria-label={`Remove ${p.process_name}`}><Trash2 className="size-3.5" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Step IV */}
      {can_manage && <Reports engagement={e} details={data.report_details} ready={data.report_ready} remaining={processes.length - s.processes_completed} untested={s.controls - s.tested} />}

      {meta && can_manage && (
        <>
          <AddProcessesModal open={adding} onClose={() => setAdding(false)} engagementId={e.id} meta={meta} existing={processes.map((p) => p.process_id)} />
          <EngagementModal open={editing} onClose={() => setEditing(false)} meta={meta} engagement={e} />
        </>
      )}
    </>
  );
}

function DueInput({ value, label, onCommit }: { value: string | null; label: string; onCommit: (v: string | null) => void }) {
  const [v, setV] = useState(value ?? "");
  return (
    <Input type="date" aria-label={label} value={v} className="h-8 w-36 text-xs" onChange={(e) => setV(e.target.value)}
      onBlur={() => { if ((v || null) !== value) onCommit(v || null); }} />
  );
}

function Reports({ engagement, details, ready, remaining, untested }: { engagement: Engagement; details: ReportDetails; ready: boolean; remaining: number; untested: number }) {
  const [busy, setBusy] = useState<"word" | "ppt" | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  async function generate(format: "word" | "ppt") {
    setBusy(format); setError("");
    try {
      const data = (await api.get<{ data: ReportData }>(`/audit/engagements/${engagement.id}/report`, { params: { format } })).data.data;
      if (format === "word") (await import("./reports/word")).downloadWordReport(data);
      else await (await import("./reports/ppt")).downloadPptReport(data);
    } catch (e) {
      setError(apiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">{!ready && <Lock className="size-4 text-muted" />} Reports</h2>
          <p className="mt-0.5 text-sm text-muted">
            {ready
              ? "All processes are fully tested. Download the detailed Word report or the PowerPoint summary."
              : `Available once every process is tested — ${remaining} process${remaining === 1 ? "" : "es"} and ${untested} control${untested === 1 ? "" : "s"} still to go.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setEditing(true)}><Settings2 className="size-4" /> Report details</Button>
          <Button variant="secondary" disabled={!ready} loading={busy === "word"} onClick={() => generate("word")}><FileText className="size-4" /> Word (detailed)</Button>
          <Button variant="secondary" disabled={!ready} loading={busy === "ppt"} onClick={() => generate("ppt")}><Presentation className="size-4" /> PowerPoint (summary)</Button>
        </div>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <ReportDetailsModal open={editing} onClose={() => setEditing(false)} engagementId={engagement.id} details={details} />
    </Card>
  );
}

/** Step II — choose processes from the library and assign a resource. */
function AddProcessesModal({ open, onClose, engagementId, meta, existing }: { open: boolean; onClose: () => void; engagementId: number; meta: Meta; existing: number[] }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<number[]>([]);
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) { setWasOpen(open); if (open) { setPicked([]); setAssignee(""); setDue(""); setError(""); } }

  const save = useMutation({
    mutationFn: () => api.post(`/audit/engagements/${engagementId}/processes`, { process_ids: picked, assigned_to: assignee ? Number(assignee) : null, due_date: due || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audit"] }); onClose(); },
    onError: (e) => setError(apiError(e).message),
  });
  const available = meta.processes.filter((p) => !existing.includes(p.id));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Modal open={open} onClose={onClose} title="Add processes for this period" wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {!available.length ? (
          <p className="text-sm text-muted">Every process in the library is already in this engagement. Add more under <Link to="/app/library" className="text-accent">Risk &amp; control library</Link>.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((p) => (
              <label key={p.id} className={cx("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm", picked.includes(p.id) ? "border-accent bg-accent-soft/50" : "border-line hover:bg-paper")}>
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="mt-0.5 accent-[var(--color-accent)]" />
                <span>
                  <span className="block font-medium">{p.name}</span>
                  <span className="text-xs text-muted">{p.risks_count} risks · {p.controls_count} controls</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assign to" hint="You can change the assignee per process later.">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Assign later</option>
              {meta.testers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Due date (optional)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked.length} loading={save.isPending} onClick={() => save.mutate()}>Add {picked.length || ""} process{picked.length === 1 ? "" : "es"}</Button>
        </div>
      </div>
    </Modal>
  );
}
