import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Drawer, EmptyState, Input, LoadingBlock, PageHeader, Select, cx } from "../components/ui";
import type { QueryRow } from "./types";
import { DueBadge, RatingBadge, StatusBadge, fmtDate, useCanTest, useMeta } from "./shared";
import { useCan } from "../admin/auth";
import { RetestForm, RetestHistory } from "./QueryParts";

const TABS = [
  ["open", "Open"],
  ["retest_due", "Due for retest"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

export default function Queries() {
  const ownOnly = !useCan()("audit.manage");
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const openId = Number(params.get("open")) || null;
  const [search, setSearch] = useState("");
  const { data: meta } = useMeta();
  const filters = { status, client_id: params.get("client_id") ?? "", fiscal_year: params.get("fiscal_year") ?? "", period: params.get("period") ?? "", mine: params.get("mine") ?? "" };

  const { data, isLoading } = useQuery({
    queryKey: ["audit", "queries", filters, search],
    queryFn: async () => (await api.get<{ data: QueryRow[]; counts: Record<string, number>; window_days: number }>("/audit/queries", {
      params: { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), search: search || undefined },
    })).data,
    placeholderData: keepPreviousData,
  });

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const selected = data?.data.find((q) => q.id === openId) ?? null;

  return (
    <>
      <PageHeader title="Queries" description={`Controls that failed testing, with management responses, closure dates and retests${ownOnly ? " — only on processes assigned to you" : ""}.`} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <div className="flex gap-1">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => update({ status: k, open: null })} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", status === k ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink")}>
              {l} <span className="ml-0.5 text-xs text-muted tabular-nums">{data?.counts[k] ?? ""}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <Input placeholder="Search reason, person, control…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-60" />
          <Select aria-label="Client" value={filters.client_id} onChange={(e) => update({ client_id: e.target.value })} className="h-9 w-48">
            <option value="">All clients</option>
            {meta?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={filters.mine === "1"} onChange={(e) => update({ mine: e.target.checked ? "1" : null })} className="accent-[var(--color-accent)]" /> Assigned to me
          </label>
        </div>
      </div>
      {(filters.fiscal_year || filters.period) && (
        <p className="mb-3 text-xs text-muted">Filtered to {filters.fiscal_year && `FY starting ${filters.fiscal_year}`} {filters.period} · <button className="text-accent" onClick={() => update({ fiscal_year: null, period: null })}>clear</button></p>
      )}

      <Card className="overflow-x-auto">
        {isLoading ? <LoadingBlock /> : !data?.data.length ? <EmptyState title="No queries here" body={status === "retest_due" ? `Nothing is due for retest in the next ${data?.window_days ?? 7} days.` : undefined} /> : (
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Ref</th>
                <th className="px-3 py-3 font-medium">Control</th>
                <th className="px-3 py-3 font-medium">Client · process</th>
                <th className="px-3 py-3 text-right font-medium">Failed</th>
                <th className="px-3 py-3 font-medium">Responsible</th>
                <th className="px-3 py-3 font-medium">Closure date</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.data.map((q) => (
                <tr key={q.id} className="cursor-pointer hover:bg-paper/60" onClick={() => update({ open: String(q.id) })}>
                  <td className="px-5 py-3 font-mono text-xs text-muted">{q.reference}</td>
                  <td className="max-w-[320px] px-3 py-3">
                    <p className="line-clamp-1 font-medium">{q.control_code} · {q.control_title}</p>
                    <p className="line-clamp-1 text-xs text-muted">{q.failure_reason}</p>
                  </td>
                  <td className="px-3 py-3"><p>{q.client}</p><p className="text-xs text-muted">{q.process_name} · {q.engagement_label}</p></td>
                  <td className="px-3 py-3 text-right tabular-nums">{q.failed_samples}/{q.sample_size}</td>
                  <td className="px-3 py-3">{q.responsible_person}</td>
                  <td className="px-3 py-3"><p className="whitespace-nowrap">{fmtDate(q.target_date)}</p><DueBadge days={q.days_to_target} closed={q.query_status === "closed"} /></td>
                  <td className="px-5 py-3"><div className="flex flex-wrap gap-1"><StatusBadge status={q.query_status} /><RatingBadge rating={q.risk_rating} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && <QueryDrawer q={selected} onClose={() => update({ open: null })} />}
    </>
  );
}

function QueryDrawer({ q, onClose }: { q: QueryRow; onClose: () => void }) {
  const canTest = useCanTest();
  const rows: [string, React.ReactNode][] = [
    ["Client", q.client],
    ["Engagement", q.engagement_label],
    ["Process", <Link to={`/app/testing/${q.engagement_process_id}`} className="text-accent">{q.process_name}</Link>],
    ["Risk", <>{q.risk_title} <RatingBadge rating={q.risk_rating} /></>],
    ["Control", `${q.control_code} · ${q.control_title}`],
    ["Samples failed", `${q.failed_samples} of ${q.sample_size} tested`],
    ["Person responsible", q.responsible_person],
    ["Timeline for closure", <>{fmtDate(q.target_date)} <DueBadge days={q.days_to_target} closed={q.query_status === "closed"} /></>],
    ["Tested by", `${q.assignee ?? "—"} on ${fmtDate(q.tested_at)}`],
  ];
  return (
    <Drawer open onClose={onClose} title={`Query ${q.reference}`} wide>
      <div className="space-y-6">
        <div className="flex items-center gap-2"><StatusBadge status={q.query_status} />{q.closed_at && <span className="text-xs text-muted">Closed {fmtDate(q.closed_at)}</span>}</div>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
          {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>))}
        </dl>
        <div>
          <p className="mb-1 text-xs font-medium text-ink-2">Reason for failure</p>
          <p className="whitespace-pre-line rounded-lg bg-danger-soft/50 p-3 text-sm">{q.failure_reason}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-ink-2">Management response</p>
          <p className="whitespace-pre-line rounded-lg bg-paper p-3 text-sm">{q.management_response}</p>
        </div>
        <RetestHistory retests={q.retests} />
        {q.query_status === "open" && canTest(q.assigned_to) && <RetestForm testId={q.id} />}
      </div>
    </Drawer>
  );
}
