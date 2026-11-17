import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, CircleDashed, Copy, Eye, ListChecks, XCircle } from "lucide-react";
import { api, apiError, type ValidationErrors } from "../lib/api";
import { Alert, Badge, Button, Card, Drawer, Field, Input, LoadingBlock, Textarea, cx } from "../components/ui";
import type { CheckResult, ControlTest, EngagementProcess, RiskGroup } from "./types";
import { RatingBadge, StatusBadge, TestProgress, fmtDate, humanize } from "./shared";
import { ResultToggle, RetestForm, RetestHistory } from "./QueryParts";

type Workspace = {
  process: EngagementProcess;
  engagement: { id: number; label: string; client: string; status: string; period_start: string; period_end: string };
  risks: RiskGroup[];
  can_test: boolean;
};

/** Step III — process → risks → controls; pick a control to test it. */
export default function ProcessTesting() {
  const { id } = useParams();
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "untested" | "fail">("all");
  const { data, isLoading } = useQuery({
    queryKey: ["audit", "process", id],
    queryFn: async () => (await api.get<{ data: Workspace }>(`/audit/engagement-processes/${id}`)).data.data,
  });

  if (isLoading || !data) return <LoadingBlock />;
  const { process: p, engagement: e, risks, can_test } = data;
  const all = risks.flatMap((r) => r.controls);
  const open = all.find((c) => c.id === openId) ?? null;
  const visible = (c: ControlTest) => filter === "all" || (filter === "untested" ? !c.result : c.result === "fail");
  const nextUntested = (afterId: number) => {
    const idx = all.findIndex((c) => c.id === afterId);
    return [...all.slice(idx + 1), ...all.slice(0, idx)].find((c) => !c.result)?.id ?? null;
  };

  return (
    <>
      <Link to={`/app/engagements/${e.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" /> {e.client} · {e.label}</Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{p.process_name}</h1>
            <StatusBadge status={p.status} />
          </div>
          <p className="mt-1 text-sm text-muted">Assigned to {p.assignee?.name ?? "nobody yet"}{p.due_date && ` · due ${fmtDate(p.due_date)}`}</p>
        </div>
        <div className="w-full max-w-sm">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>{p.counts.tested} of {p.counts.total} controls tested</span>
            <span>{p.counts.passed} pass · <span className={cx(p.counts.failed > 0 && "text-danger")}>{p.counts.failed} fail</span></span>
          </div>
          <TestProgress counts={p.counts} className="h-2.5" />
        </div>
      </div>

      {p.status === "completed" ? (
        <div className="mb-5"><Alert tone="green"><span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4" /> Testing complete — every control has a result.</span></Alert></div>
      ) : !can_test ? (
        <div className="mb-5"><Alert tone="amber"><span className="inline-flex items-center gap-2"><Eye className="size-4" /> View only — this process is assigned to {p.assignee?.name ?? "someone else"}.</span></Alert></div>
      ) : (
        <p className="mb-5 text-sm text-muted">Testing for this process is complete only when every control below has a Pass or Fail result.</p>
      )}

      <div className="mb-4 flex gap-1 border-b border-line">
        {([["all", `All (${all.length})`], ["untested", `Untested (${all.filter((c) => !c.result).length})`], ["fail", `Failed (${all.filter((c) => c.result === "fail").length})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", filter === k ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>

      <div className="space-y-4">
        {risks.map((r) => {
          const controls = r.controls.filter(visible);
          if (!controls.length) return null;
          return (
            <Card key={r.risk_id} className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-paper/50 px-5 py-3">
                <div>
                  <p className="font-mono text-[11px] text-muted">Risk {r.code}</p>
                  <p className="font-medium">{r.title}</p>
                </div>
                <RatingBadge rating={r.rating} />
              </div>
              <ul className="divide-y divide-line">
                {controls.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-paper/60">
                      <span className="w-16 shrink-0 font-mono text-xs text-muted">{c.snapshot.control_code}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">{c.snapshot.control_title}</span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                          <span>{humanize(c.snapshot.nature)}</span><span>{humanize(c.snapshot.control_type)}</span><span>{humanize(c.snapshot.frequency)}</span>
                          <span className="inline-flex items-center gap-1"><ListChecks className="size-3" />{Object.values(c.check_results).filter((r) => r.result).length}/{c.snapshot.checks.length} checks tested</span>
                          {c.population !== null && <span>Sample {c.sample_size}/{c.population}</span>}
                        </span>
                      </span>
                      {c.query_status && <span className="hidden font-mono text-xs text-muted sm:inline">{c.reference}</span>}
                      <StatusBadge status={c.result} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      {open && (
        <ControlDrawer
          key={open.id}
          test={open}
          canTest={can_test}
          onClose={() => setOpenId(null)}
          onSavedNext={() => setOpenId(nextUntested(open.id))}
        />
      )}
    </>
  );
}

const asStr = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

type CheckForm = { population: string; sample_size: string; result: string; notes: string };
const toCheckForm = (r?: CheckResult): CheckForm => ({
  population: asStr(r?.population), sample_size: asStr(r?.sample_size), result: r?.result ?? "", notes: r?.notes ?? "",
});

/** Any failed check fails the control; it passes only when every check has passed. */
function deriveResult(checks: CheckForm[]): "" | "pass" | "fail" {
  if (!checks.length) return "";
  if (checks.some((c) => c.result === "fail")) return "fail";
  return checks.every((c) => c.result === "pass") ? "pass" : "";
}

function ControlDrawer({ test: t, canTest, onClose, onSavedNext }: { test: ControlTest; canTest: boolean; onClose: () => void; onSavedNext: () => void }) {
  const qc = useQueryClient();
  const s = t.snapshot;
  const locked = t.retests.length > 0;
  const editable = canTest && !locked;
  const perCheck = s.checks.length > 0;
  const [form, setForm] = useState({
    // Controls without a checklist are still recorded at control level.
    population: asStr(t.population), sample_size: asStr(t.sample_size), result: t.result ?? "", test_notes: t.test_notes ?? "",
    failure_reason: t.failure_reason ?? "", failed_samples: asStr(t.failed_samples), management_response: t.management_response ?? "",
    target_date: t.target_date ?? "", responsible_person: t.responsible_person ?? "",
  });
  const [checks, setChecks] = useState<Record<string, CheckForm>>(
    () => Object.fromEntries(s.checks.map((c) => [String(c.id), toCheckForm(t.check_results[c.id])])),
  );
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [error, setError] = useState("");
  const [showRetest, setShowRetest] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setCheck = (id: number, patch: Partial<CheckForm>) => setChecks((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const rows = s.checks.map((c) => checks[c.id]);
  const result = perCheck ? deriveResult(rows) : form.result;
  const tested = rows.filter((r) => r.result).length;
  const failedCap = rows.filter((r) => r.result === "fail").reduce((n, r) => n + (Number(r.sample_size) || 0), 0);
  const firstPopulation = rows[0]?.population ?? "";
  const canCopyPopulation = editable && perCheck && s.checks.length > 1 && firstPopulation !== "" && rows.some((r) => r.population !== firstPopulation);

  const save = useMutation({
    mutationFn: async (_next: boolean) => api.put(`/audit/control-tests/${t.id}`, {
      ...(perCheck
        ? {
            check_results: Object.fromEntries(s.checks.map((c) => {
              const r = checks[c.id];
              return [c.id, { population: num(r.population), sample_size: num(r.sample_size), result: r.result || null, notes: r.notes.trim() || null }];
            })),
            test_notes: t.test_notes,
          }
        : { population: num(form.population), sample_size: num(form.sample_size), result: form.result || null, test_notes: form.test_notes || null }),
      ...(result === "fail" ? {
        failure_reason: form.failure_reason, failed_samples: num(form.failed_samples), management_response: form.management_response,
        target_date: form.target_date || null, responsible_person: form.responsible_person,
      } : {}),
    }),
    onSuccess: async (_r, next) => {
      await qc.invalidateQueries({ queryKey: ["audit"] });
      if (next) onSavedNext(); else onClose();
    },
    onError: (e) => { const x = apiError(e); setErrors(x.errors); setError(x.message); },
  });

  const checkErr = (id: number, f: keyof CheckForm) => errors[`check_results.${id}.${f}`]?.[0];

  return (
    <Drawer open onClose={onClose} title={`${s.control_code ?? "Control"} · ${t.result ? "Test result" : "Test control"}`} wide
      footer={editable ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ResultSummary result={result} tested={tested} total={s.checks.length} perCheck={perCheck} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="secondary" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Save</Button>
            <Button loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Save &amp; next untested</Button>
          </div>
        </div>
      ) : undefined}>
      <div className="space-y-6">
        <section>
          <div className="flex flex-wrap items-center gap-2"><RatingBadge rating={s.risk_rating} /><span className="text-xs text-muted">Risk {s.risk_code}: {s.risk_title}</span></div>
          <h3 className="mt-3 text-base font-semibold">{s.control_title}</h3>
          {s.control_description && <p className="mt-1 text-sm text-ink-2">{s.control_description}</p>}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            {[["Nature", s.nature], ["Type", s.control_type], ["Frequency", s.frequency], ["Owner", s.owner]].map(([k, v]) => (
              <div key={k}><dt className="text-muted">{k}</dt><dd className="font-medium">{k === "Owner" ? v ?? "—" : humanize(v)}</dd></div>
            ))}
          </dl>
        </section>

        {locked && <Alert tone="amber">This query has been retested, so the original result is locked. Use the retest form below.</Alert>}
        {error && !Object.keys(errors).length && <Alert>{error}</Alert>}

        {perCheck ? (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-ink-2">Checks to perform</p>
              <div className="flex items-center gap-3">
                {canCopyPopulation && (
                  <button type="button" onClick={() => setChecks((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, population: firstPopulation }])))}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    <Copy className="size-3" /> Use population {firstPopulation} for all checks
                  </button>
                )}
                <span className="text-xs text-muted">{tested}/{s.checks.length} tested</span>
              </div>
            </div>
            <ol className="space-y-3">
              {s.checks.map((c, i) => {
                const r = checks[c.id];
                return (
                  <li key={c.id} className={cx(
                    "rounded-xl border bg-white transition-colors",
                    r.result === "fail" ? "border-danger/40" : r.result === "pass" ? "border-accent/35" : "border-line",
                  )}>
                    <div className={cx("flex items-start gap-3 rounded-t-xl px-4 py-3",
                      r.result === "fail" ? "bg-danger-soft/50" : r.result === "pass" ? "bg-accent-soft/50" : "bg-paper/60")}>
                      <CheckStatusIcon result={r.result} />
                      <p className="min-w-0 flex-1 text-sm leading-snug">
                        <span className="mr-1.5 font-mono text-[11px] text-muted">{i + 1}.</span>{c.description}
                      </p>
                      <StatusBadge status={r.result || null} />
                    </div>
                    <fieldset disabled={!editable} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_1fr_auto]">
                      <Field label="Total population" error={checkErr(c.id, "population")}>
                        <Input type="number" min={0} inputMode="numeric" value={r.population} onChange={(e) => setCheck(c.id, { population: e.target.value })} />
                      </Field>
                      <Field label="Samples tested" error={checkErr(c.id, "sample_size")}>
                        <Input type="number" min={0} inputMode="numeric" value={r.sample_size} onChange={(e) => setCheck(c.id, { sample_size: e.target.value })} />
                      </Field>
                      <div>
                        <span className="mb-1.5 block text-xs font-medium text-ink-2">Test result</span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(["pass", "fail"] as const).map((v) => (
                            <button key={v} type="button" aria-pressed={r.result === v} onClick={() => setCheck(c.id, { result: r.result === v ? "" : v })}
                              className={cx(
                                "h-10 min-w-[4.5rem] rounded-lg border px-3 text-sm font-medium disabled:cursor-not-allowed",
                                r.result === v ? (v === "pass" ? "border-accent bg-accent text-white" : "border-danger bg-danger text-white") : "border-line bg-white text-ink-2 hover:bg-paper-2",
                              )}>
                              {v === "pass" ? "Pass" : "Fail"}
                            </button>
                          ))}
                        </div>
                        {checkErr(c.id, "result") && <p className="mt-1 text-xs text-danger">{checkErr(c.id, "result")}</p>}
                      </div>
                      <Field label="Testing notes (optional)" error={checkErr(c.id, "notes")} className="sm:col-span-3">
                        <Textarea rows={2} value={r.notes} placeholder={r.result === "fail" ? "What was wrong with the samples?" : "Evidence inspected, exceptions noted…"}
                          onChange={(e) => setCheck(c.id, { notes: e.target.value })} />
                      </Field>
                    </fieldset>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <fieldset disabled={!editable} className="space-y-4">
            <p className="text-sm text-muted">No checks are listed for this control, so record the test for the control as a whole.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total population" error={errors.population?.[0]}><Input type="number" min={0} inputMode="numeric" value={form.population} onChange={(e) => set({ population: e.target.value })} /></Field>
              <Field label="Samples tested" error={errors.sample_size?.[0]}><Input type="number" min={0} inputMode="numeric" value={form.sample_size} onChange={(e) => set({ sample_size: e.target.value })} /></Field>
            </div>
            <ResultToggle value={form.result} onChange={(v) => set({ result: v })} error={errors.result?.[0]} disabled={!editable} />
            <Field label="Testing notes (optional)" error={errors.test_notes?.[0]}><Textarea rows={2} value={form.test_notes} onChange={(e) => set({ test_notes: e.target.value })} /></Field>
          </fieldset>
        )}

        {result === "fail" && (
          <fieldset disabled={!editable} className="space-y-4 rounded-lg border border-danger/25 bg-danger-soft/40 p-4">
            <div>
              <p className="text-sm font-medium text-danger">Query details {t.query_status && <span className="ml-1 font-mono text-xs">{t.reference}</span>}</p>
              {perCheck && <p className="mt-0.5 text-xs text-muted">A failed check fails this control and raises a query for management to respond to.</p>}
            </div>
            <Field label="Reason for failure" error={errors.failure_reason?.[0]}><Textarea rows={3} value={form.failure_reason} onChange={(e) => set({ failure_reason: e.target.value })} /></Field>
            <Field label="Number of samples failed" error={errors.failed_samples?.[0]} className="max-w-[16rem]"
              hint={perCheck && failedCap > 0 ? `Up to ${failedCap} (samples tested on failed checks)` : undefined}>
              <Input type="number" min={1} value={form.failed_samples} onChange={(e) => set({ failed_samples: e.target.value })} />
            </Field>
            <Field label="Management response" error={errors.management_response?.[0]}><Textarea rows={3} value={form.management_response} onChange={(e) => set({ management_response: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Timeline for closure" error={errors.target_date?.[0]} hint="The query appears in 'Due for retest' from this date."><Input type="date" value={form.target_date} onChange={(e) => set({ target_date: e.target.value })} /></Field>
              <Field label="Person responsible" error={errors.responsible_person?.[0]}><Input value={form.responsible_person} onChange={(e) => set({ responsible_person: e.target.value })} /></Field>
            </div>
          </fieldset>
        )}

        {!editable && <ResultSummary result={result} tested={tested} total={s.checks.length} perCheck={perCheck} />}
        {t.tested_by && <p className="text-xs text-muted">Recorded by {t.tested_by.name} on {fmtDate(t.tested_at)}</p>}

        {t.query_status && (
          <section className="space-y-4 border-t border-line pt-5">
            <div className="flex items-center gap-2"><span className="font-mono text-xs text-muted">{t.reference}</span><StatusBadge status={t.query_status} /></div>
            <RetestHistory retests={t.retests} />
            {t.query_status === "open" && canTest && (showRetest
              ? <RetestForm testId={t.id} onDone={() => setShowRetest(false)} />
              : <Button variant="secondary" size="sm" onClick={() => setShowRetest(true)}>Record retest</Button>)}
          </section>
        )}
      </div>
    </Drawer>
  );
}

function CheckStatusIcon({ result }: { result: string }) {
  if (result === "pass") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-label="Passed" />;
  if (result === "fail") return <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Failed" />;
  return <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Not tested" />;
}

/** Control-level outcome derived from the checks. */
function ResultSummary({ result, tested, total, perCheck }: { result: string; tested: number; total: number; perCheck: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className="text-muted">Control result</span>
      {!result && perCheck && tested > 0 ? <Badge tone="amber" className="normal-case!">In progress</Badge> : <StatusBadge status={result || null} />}
      {perCheck && !result && <span className="text-xs text-muted">{tested}/{total} checks tested</span>}
    </p>
  );
}
