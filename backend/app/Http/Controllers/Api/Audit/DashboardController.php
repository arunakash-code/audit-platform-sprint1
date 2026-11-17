<?php

namespace App\Http\Controllers\Api\Audit;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\Engagement;
use App\Models\EngagementProcess;
use App\Services\AuditWorkflow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Dashboard for a period (fiscal year + quarter), optionally one client:
 *  1. testing status by process and control
 *  2. queries raised
 *  3. queries due for retest (closure date reached or within the window) — across all periods
 */
class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        // Auditors only see processes (and their queries) assigned to them.
        $mine = AuditWorkflow::restrictedTo($request);
        $visible = fn ($q) => $mine ? $q->whereHas('processes', fn ($w) => $w->where('assigned_to', $mine)) : $q;

        // Default to the period of the most recent engagement so the dashboard opens on live data.
        $latest = $visible(Engagement::query())->orderByDesc('period_start')->first();
        $fy = $request->has('fiscal_year') ? $request->integer('fiscal_year') : $latest?->fiscal_year;
        $period = $request->has('period') ? (string) $request->query('period') : $latest?->period;
        $clientId = $request->integer('client_id') ?: null;

        $engagements = $visible(Engagement::with('client:id,name'))
            ->when($fy, fn ($q) => $q->where('fiscal_year', $fy))
            ->when($period, fn ($q) => $q->where('period', $period))
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            ->orderBy('client_id')
            ->get();

        $eps = EngagementProcess::with('assignee:id,name')
            ->whereIn('engagement_id', $engagements->pluck('id'))
            ->when($mine, fn ($q) => $q->where('assigned_to', $mine))
            ->orderBy('engagement_id')->orderBy('id')
            ->get();
        $counts = AuditWorkflow::processCounts($eps->pluck('id')->all());
        $byEngagement = $engagements->keyBy('id');

        $processes = $eps->map(fn ($ep) => AuditWorkflow::presentProcess($ep, $counts[$ep->id] ?? []) + [
            'client' => $byEngagement[$ep->engagement_id]->client?->name,
            'engagement_label' => $byEngagement[$ep->engagement_id]->label,
        ]);

        $scope = new Request(array_filter(['fiscal_year' => $fy, 'period' => $period, 'client_id' => $clientId]));
        $queryRows = fn ($builder) => $builder->with(['engagement.client:id,name', 'engagementProcess.assignee:id,name'])->get()->map(fn ($t) => AuditWorkflow::presentQuery($t));

        $raised = $queryRows(QueryController::scoped($scope, $mine)->orderByRaw('CASE WHEN query_status = ? THEN 0 ELSE 1 END', ['open'])->orderByDesc('tested_at')->limit(50));
        // Retests fall due after the period closes, so this list spans all periods (client filter still applies).
        $retestScope = new Request(array_filter(['client_id' => $clientId]));
        $retest = $queryRows(QueryController::dueForRetest(QueryController::scoped($retestScope, $mine))->orderBy('target_date')->limit(50));

        $years = $visible(Engagement::query())->distinct()->orderByDesc('fiscal_year')->pluck('fiscal_year');

        return response()->json(['data' => [
            'filters' => ['fiscal_year' => $fy, 'period' => $period, 'client_id' => $clientId],
            'options' => [
                'fiscal_years' => $years->map(fn ($y) => ['value' => $y, 'label' => Engagement::fyLabelFor($y)]),
                'clients' => Client::query()
                    ->when($mine, fn ($q) => $q->whereHas('engagements.processes', fn ($w) => $w->where('assigned_to', $mine)))
                    ->orderBy('name')->get(['id', 'name']),
            ],
            'engagements' => $engagements->map(fn ($e) => ['id' => $e->id, 'client' => $e->client?->name, 'label' => $e->label, 'status' => $e->status]),
            'totals' => [
                'engagements' => $engagements->count(),
                'processes' => $processes->count(),
                'processes_completed' => $processes->where('status', 'completed')->count(),
                'processes_in_progress' => $processes->where('status', 'in_progress')->count(),
                'controls' => $processes->sum('counts.total'),
                'tested' => $processes->sum('counts.tested'),
                'passed' => $processes->sum('counts.passed'),
                'failed' => $processes->sum('counts.failed'),
                'open_queries' => $processes->sum('counts.open_queries'),
                'retest_due' => $retest->count(),
                'retest_overdue' => $retest->filter(fn ($q) => $q['days_to_target'] !== null && $q['days_to_target'] < 0)->count(),
            ],
            'processes' => $processes->values(),
            'queries' => $raised,
            'retest' => $retest,
            'window_days' => (int) config('audit.retest_window_days', 7),
        ]]);
    }
}
