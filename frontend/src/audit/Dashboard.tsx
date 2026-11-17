import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { Card, EmptyState, LoadingBlock, PageHeader, Select } from "../components/ui";
import { useCan } from "../admin/auth";
import type { EngagementProcess, QueryRow } from "./types";
import { DueBadge, ProgressLegend, RatingBadge, Stat, StatusBadge, TestProgress, fmtDate } from "./shared";

type Dash = {
  filters: { fiscal_year: number | null; period: string | null; client_id: number | null };
  options: { fiscal_years: { value: number; label: string }[]; clients: { id: number; name: string }[] };
  engagements: { id: number; client: string; label: string; status: string }[];
  totals: {
    engagements: number; processes: number; processes_completed: number; processes_in_progress: number;
    controls: number; tested: number; passed: number; failed: number; open_queries: number; retest_due: number; retest_overdue: number;
  };
  processes: EngagementProcess[];
  queries: QueryRow[];
  retest: QueryRow[];
  window_days: number;
};

export default function AuditDashboard() {
  const ownOnly = !useCan()("audit.manage");
  const [filters, setFilters] = useState<{ fiscal_year?: string; period?: string; client_id?: string }>({});
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["audit", "dashboard", filters],
    queryFn: async () => (await api.get<{ data: Dash }>("/audit/dashboard", { params: filters })).data.data,
    placeholderData: keepPreviousData,
  });

  if (isLoading || !data) return <LoadingBlock />;
  const t = data.totals;
  const f = data.filters;
  const pct = t.controls ? Math.round((t.tested / t.controls) * 100) : 0;
  const set = (k: keyof typeof filters, v: string) => setFilters((p) => ({ ...p, fiscal_year: String(f.fiscal_year ?? ""), period: f.period ?? "", [k]: v }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Testing status, queries raised and retests due for the selected period${ownOnly ? " — showing only processes assigned to you" : ""}.`}
        actions={
          <>
            <Select aria-label="Fiscal year" value={String(f.fiscal_year ?? "")} onChange={(e) => set("fiscal_year", e.target.value)} className="w-36">
              <option value="">All years</option>
              {data.options.fiscal_years.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
            </Select>
            <Select aria-label="Period" value={f.period ?? ""} onChange={(e) => set("period", e.target.value)} className="w-32">
              <option value="">All periods</option>
              {["Q1", "Q2", "Q3", "Q4"].map((q) => <option key={q} value={q}>{q}</option>)}
              <option value="FY">Full year</option>
            </Select>
            <Select aria-label="Client" value={String(f.client_id ?? "")} onChange={(e) => set("client_id", e.target.value)} className="w-52">
              <option value="">All clients</option>
              {data.options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Processes complete" value={`${t.processes_completed}/${t.processes}`} sub={`${t.processes_in_progress} in progress`} />
        <Stat label="Controls tested" value={`${pct}%`} sub={`${t.tested} of ${t.controls}`} />
        <Stat label="Controls failed" value={t.failed} sub={`${t.passed} passed`} tone={t.failed ? "red" : undefined} />
        <Stat label="Open queries" value={t.open_queries} sub="raised in this period" tone={t.open_queries ? "amber" : undefined} />
        <Stat label="Due for retest" value={t.retest_due} sub={t.retest_overdue ? `${t.retest_overdue} overdue` : `next ${data.window_days} days`} tone={t.retest_overdue ? "red" : undefined} />
      </div>

      {/* 1. Testing status — process and control wise */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="font-semibold">Testing status by process</h2>
            <p className="text-xs text-muted">{data.engagements.length ? data.engagements.map((e) => `${e.client} · ${e.label}`).join("  |  ") : "No engagements in this period"}</p>
          </div>
          <ProgressLegend />
        </div>
        {!data.processes.length ? (
          <EmptyState title="Nothing to show for this period" body="Create an engagement and add processes to start tracking testing." action={<Link to="/app/engagements" className="text-sm font-medium text-accent">Go to engagements →</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Process</th>
                  <th className="px-3 py-2.5 font-medium">Assigned to</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-[26%] px-3 py-2.5 font-medium">Controls</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tested</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pass</th>
                  <th className="px-5 py-2.5 text-right font-medium">Fail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.processes.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-paper/60" onClick={() => navigate(`/app/testing/${p.id}`)}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{p.process_name}</p>
                      <p className="text-xs text-muted">{p.client} · {p.engagement_label}</p>
                    </td>
                    <td className="px-3 py-3 text-ink-2">{p.assignee?.name ?? <span className="text-muted">Unassigned</span>}</td>
                    <td className="px-3 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-3 py-3"><TestProgress counts={p.counts} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.counts.tested}/{p.counts.total}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.counts.passed}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{p.counts.failed ? <span className="font-medium text-danger">{p.counts.failed}</span> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {/* 2. Queries raised */}
        <QueryList
          title="Queries raised"
          subtitle="Failed controls in this period"
          rows={data.queries}
          empty="No queries raised — every tested control passed."
          link={`/app/queries?status=all${f.fiscal_year ? `&fiscal_year=${f.fiscal_year}` : ""}${f.period ? `&period=${f.period}` : ""}`}
        />
        {/* 3. Due for retest */}
        <QueryList
          title="Due for retest"
          subtitle={`Open queries whose closure date has passed or falls in the next ${data.window_days} days (all periods)`}
          rows={data.retest}
          empty="No retests due."
          link="/app/queries?status=retest_due"
          showDue
        />
      </div>
    </>
  );
}

function QueryList({ title, subtitle, rows, empty, link, showDue }: { title: string; subtitle: string; rows: QueryRow[]; empty: string; link: string; showDue?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 className="font-semibold">{title} <span className="ml-1 text-sm font-normal text-muted tabular-nums">{rows.length}</span></h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <Link to={link} className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent">View all <ArrowRight className="size-3" /></Link>
      </div>
      {!rows.length ? <EmptyState title={empty} /> : (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {rows.map((q) => (
            <li key={q.id}>
              <Link to={`/app/queries?status=all&open=${q.id}`} className="block px-5 py-3 hover:bg-paper/60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{q.reference}</span>
                  <StatusBadge status={q.query_status} />
                  <RatingBadge rating={q.risk_rating} />
                  {showDue && <DueBadge days={q.days_to_target} />}
                </div>
                <p className="mt-1 line-clamp-1 text-sm font-medium">{q.control_code} · {q.control_title}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted">{q.failure_reason}</p>
                <p className="mt-1 text-xs text-muted">{q.client} · {q.process_name} · {q.responsible_person} · closure {fmtDate(q.target_date)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
