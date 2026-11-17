import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, apiError, type ValidationErrors } from "../lib/api";
import { useCan } from "../admin/auth";
import { Alert, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, Textarea, cx } from "../components/ui";
import type { Engagement, Meta } from "./types";
import { StatusBadge, TestProgress, fmtDate, useMeta } from "./shared";

export default function Engagements() {
  const can = useCan();
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const { data: meta } = useMeta();
  const { data, isLoading } = useQuery({
    queryKey: ["audit", "engagements", clientId, status],
    queryFn: async () => (await api.get<{ data: Engagement[] }>("/audit/engagements", { params: { client_id: clientId || undefined, status: status || undefined } })).data.data,
  });

  return (
    <>
      <PageHeader
        title="Engagements"
        description={can("audit.manage") ? "One engagement per client, audit type and period. Open one to choose processes and assign the team." : "Engagements where processes are assigned to you."}
        actions={
          <>
            <Select aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-52">
              <option value="">All clients</option>
              {meta?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
              <option value="">Any status</option>
              <option value="planning">Planning</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
            </Select>
            {can("audit.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> New engagement</Button>}
          </>
        }
      />

      <Card className="overflow-x-auto">
        {isLoading ? <LoadingBlock /> : !data?.length ? (
          <EmptyState title="No engagements yet" body="Start by choosing a client, the type of audit and the period." action={can("audit.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> New engagement</Button>} />
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-3 py-3 font-medium">Engagement</th>
                <th className="px-3 py-3 font-medium">Period</th>
                <th className="px-3 py-3 font-medium">Processes</th>
                <th className="w-[20%] px-3 py-3 font-medium">Controls tested</th>
                <th className="px-3 py-3 text-right font-medium">Open queries</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((e) => {
                const counts = { total: e.controls_total ?? 0, tested: e.controls_tested ?? 0, failed: e.controls_failed ?? 0, passed: (e.controls_tested ?? 0) - (e.controls_failed ?? 0), open_queries: e.open_queries ?? 0 };
                return (
                  <tr key={e.id} className="hover:bg-paper/60">
                    <td className="px-5 py-3"><Link to={`/app/engagements/${e.id}`} className="font-medium hover:text-accent">{e.client?.name}</Link></td>
                    <td className="px-3 py-3"><Link to={`/app/engagements/${e.id}`} className="hover:text-accent">{e.label}</Link><p className="text-xs text-muted capitalize">{e.frequency}</p></td>
                    <td className="px-3 py-3 text-xs text-muted">{fmtDate(e.period_start)} – {fmtDate(e.period_end)}</td>
                    <td className="px-3 py-3 tabular-nums">{e.processes_completed}/{e.processes_count} done</td>
                    <td className="px-3 py-3"><div className="flex items-center gap-2"><TestProgress counts={counts} /><span className="shrink-0 text-xs tabular-nums text-muted">{counts.tested}/{counts.total}</span></div></td>
                    <td className={cx("px-3 py-3 text-right tabular-nums", counts.open_queries > 0 && "font-medium text-danger")}>{counts.open_queries}</td>
                    <td className="px-5 py-3"><StatusBadge status={e.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {meta && <EngagementModal open={creating} onClose={() => setCreating(false)} meta={meta} />}
    </>
  );
}

/** Step I — choose client, audit type, frequency and period. */
export function EngagementModal({ open, onClose, meta, engagement }: { open: boolean; onClose: () => void; meta: Meta; engagement?: Engagement }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const blank = { client_id: "", audit_type: "internal", frequency: "quarterly", fiscal_year: String(meta.options.current_fiscal_year), period: "Q1", notes: "" };
  const [form, setForm] = useState(blank);
  const [newClient, setNewClient] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const k = `${open}-${engagement?.id ?? "new"}`;
  if (k !== key) {
    setKey(k); setErrors({}); setError(""); setNewClient(null);
    setForm(engagement ? {
      client_id: String(engagement.client_id), audit_type: engagement.audit_type, frequency: engagement.frequency,
      fiscal_year: String(engagement.fiscal_year), period: engagement.period, notes: engagement.notes ?? "",
    } : blank);
  }

  const save = useMutation({
    mutationFn: async () => {
      let clientId = form.client_id;
      if (newClient !== null) {
        const res = await api.post("/audit/clients", { name: newClient, status: "active" });
        clientId = String(res.data.data.id);
        // Keep the new client selected so a retry (e.g. after a period clash) doesn't create it twice.
        await qc.invalidateQueries({ queryKey: ["audit", "meta"] });
        setNewClient(null);
        setForm((f) => ({ ...f, client_id: clientId }));
      }
      const payload = { ...form, client_id: clientId };
      return engagement ? api.put(`/audit/engagements/${engagement.id}`, payload) : api.post("/audit/engagements", payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["audit"] });
      onClose();
      if (!engagement) navigate(`/app/engagements/${res.data.data.id}`);
    },
    onError: (e) => { const x = apiError(e); setErrors(x.errors); setError(x.message); },
  });

  const periods = meta.options.periods[form.frequency] ?? [];
  const setFreq = (frequency: string) => setForm((f) => ({ ...f, frequency, period: frequency === "annual" ? "FY" : f.period === "FY" ? "Q1" : f.period }));

  return (
    <Modal open={open} onClose={onClose} title={engagement ? "Edit engagement" : "New engagement"} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5">
        {error && !Object.keys(errors).length && <Alert>{error}</Alert>}

        <Field label="Client" error={errors.client_id?.[0] ?? errors.name?.[0]}>
          {newClient === null ? (
            <div className="flex gap-2">
              <Select required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">Choose a client…</option>
                {meta.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {!engagement && <Button type="button" variant="secondary" onClick={() => setNewClient("")} className="shrink-0">New client</Button>}
            </div>
          ) : (
            <div className="flex gap-2">
              <Input autoFocus required placeholder="Client name" value={newClient} onChange={(e) => setNewClient(e.target.value)} />
              <Button type="button" variant="ghost" onClick={() => setNewClient(null)} className="shrink-0">Choose existing</Button>
            </div>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Choice label="Type of audit" value={form.audit_type} onChange={(v) => setForm({ ...form, audit_type: v })} options={[["internal", "Internal"], ["statutory", "Statutory"]]} />
          <Choice label="Frequency" value={form.frequency} onChange={setFreq} options={[["quarterly", "Quarterly"], ["annual", "Annual"]]} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fiscal year" error={errors.fiscal_year?.[0]}>
            <Select value={form.fiscal_year} onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })}>
              {meta.options.fiscal_years.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
            </Select>
          </Field>
          <Field label="Period" error={errors.period?.[0]}>
            <Select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} disabled={form.frequency === "annual"}>
              {periods.map((p) => <option key={p} value={p}>{p === "FY" ? "Full year" : p}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Notes (optional)"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{engagement ? "Save" : "Create and choose processes"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-ink-2">{label}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-paper-2 p-1">
        {options.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={cx("h-8 rounded-md text-sm", value === v ? "bg-white font-medium shadow-sm" : "text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
    </fieldset>
  );
}
