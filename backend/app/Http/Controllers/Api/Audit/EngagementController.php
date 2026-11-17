<?php

namespace App\Http\Controllers\Api\Audit;

use App\Http\Controllers\Controller;
use App\Models\Engagement;
use App\Models\EngagementProcess;
use App\Services\AuditLogger;
use App\Services\AuditWorkflow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class EngagementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        // Auditors only see engagements where they have assigned work, counted over their processes only.
        $mine = AuditWorkflow::restrictedTo($request);
        $ownProcesses = fn ($q) => $mine ? $q->where('assigned_to', $mine) : $q;
        $ownTests = fn ($q) => $mine ? $q->whereHas('engagementProcess', fn ($w) => $w->where('assigned_to', $mine)) : $q;

        $engagements = Engagement::with('client:id,name')
            ->withCount([
                'processes' => $ownProcesses,
                'processes as processes_completed' => fn ($q) => $ownProcesses($q->where('status', 'completed')),
                'tests as controls_total' => $ownTests,
                'tests as controls_tested' => fn ($q) => $ownTests($q->whereNotNull('result')),
                'tests as controls_failed' => fn ($q) => $ownTests($q->where('result', 'fail')),
                'tests as open_queries' => fn ($q) => $ownTests($q->where('query_status', 'open')),
            ])
            ->when($mine, fn ($q) => $q->whereHas('processes', fn ($w) => $w->where('assigned_to', $mine)))
            ->when($request->query('client_id'), fn ($q, $v) => $q->where('client_id', $v))
            ->when($request->query('fiscal_year'), fn ($q, $v) => $q->where('fiscal_year', $v))
            ->when($request->query('status'), fn ($q, $v) => $q->where('status', $v))
            ->orderByDesc('fiscal_year')->orderByDesc('period_start')->orderBy('id')
            ->get();

        return response()->json(['data' => $engagements]);
    }

    /** Step I — choose client, audit type, frequency and period. */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        [$start, $end] = Engagement::periodDates($data['fiscal_year'], $data['period']);

        $engagement = Engagement::create($data + [
            'period_start' => $start, 'period_end' => $end, 'status' => 'planning', 'created_by' => $request->user()->id,
        ]);
        AuditLogger::record('engagement.created', $engagement, null, $engagement->only(['client_id', 'audit_type', 'frequency', 'fiscal_year', 'period']));

        return response()->json(['data' => $engagement->load('client:id,name')], 201);
    }

    public function show(Request $request, Engagement $engagement): JsonResponse
    {
        $mine = AuditWorkflow::restrictedTo($request);
        if ($mine && !$engagement->processes()->where('assigned_to', $mine)->exists()) {
            return response()->json(['message' => 'This engagement has no work assigned to you.'], 404);
        }
        $engagement->load([
            'client',
            'processes' => fn ($q) => $mine ? $q->where('assigned_to', $mine) : $q,
            'processes.assignee:id,name',
        ]);
        $counts = AuditWorkflow::processCounts($engagement->processes->pluck('id')->all());
        $processes = $engagement->processes->map(fn ($ep) => AuditWorkflow::presentProcess($ep, $counts[$ep->id] ?? []));

        return response()->json(['data' => [
            'engagement' => $engagement->makeHidden('processes'),
            'processes' => $processes,
            'summary' => [
                'processes' => $processes->count(),
                'processes_completed' => $processes->where('status', 'completed')->count(),
                'controls' => $processes->sum('counts.total'),
                'tested' => $processes->sum('counts.tested'),
                'passed' => $processes->sum('counts.passed'),
                'failed' => $processes->sum('counts.failed'),
                'open_queries' => $processes->sum('counts.open_queries'),
            ],
            'can_manage' => AuditWorkflow::can($request, 'audit.manage'),
            'report_ready' => $engagement->status === 'completed',
        ]]);
    }

    public function update(Request $request, Engagement $engagement): JsonResponse
    {
        $data = $this->validated($request, $engagement);
        $before = $engagement->only(array_keys($data));
        if ($data['fiscal_year'] !== $engagement->fiscal_year || $data['period'] !== $engagement->period) {
            [$data['period_start'], $data['period_end']] = Engagement::periodDates($data['fiscal_year'], $data['period']);
        }
        $engagement->update($data);
        [$b, $a] = AuditLogger::diff($before, $engagement->only(array_keys($before)));
        AuditLogger::record('engagement.updated', $engagement, $b, $a);

        return response()->json(['data' => $engagement]);
    }

    public function destroy(Engagement $engagement): JsonResponse
    {
        if ($engagement->tests()->whereNotNull('result')->exists()) {
            return response()->json(['message' => 'Testing has already been recorded for this engagement, so it cannot be deleted.'], 422);
        }
        $engagement->delete();
        AuditLogger::record('engagement.deleted', $engagement, $engagement->only(['client_id', 'fiscal_year', 'period', 'audit_type']));

        return response()->json(['success' => true]);
    }

    /** Step II — add processes for the period and (optionally) assign them in one go. */
    public function addProcesses(Request $request, Engagement $engagement): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant')->id;
        $data = $request->validate([
            'process_ids' => ['required', 'array', 'min:1', 'max:50'],
            'process_ids.*' => ['integer', Rule::exists('audit_processes', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at')],
            'assigned_to' => ['nullable', 'integer', $this->testerRule($tenantId)],
            'due_date' => ['nullable', 'date'],
        ]);

        $created = AuditWorkflow::addProcesses($engagement, $data['process_ids'], $data['assigned_to'] ?? null, $data['due_date'] ?? null);
        AuditLogger::record('engagement.processes_added', $engagement, null, [
            'processes' => $created->pluck('process_name')->all(),
            'assigned_to' => $data['assigned_to'] ?? null,
        ]);

        return response()->json(['data' => ['added' => $created->count()]], 201);
    }

    /** Step II — (re)assign the resource or due date for one process. */
    public function updateProcess(Request $request, EngagementProcess $engagementProcess): JsonResponse
    {
        $tenantId = $request->attributes->get('tenant')->id;
        $data = $request->validate([
            'assigned_to' => ['nullable', 'integer', $this->testerRule($tenantId)],
            'due_date' => ['nullable', 'date'],
        ]);
        $before = $engagementProcess->only(['assigned_to', 'due_date']);
        $engagementProcess->update($data);
        [$b, $a] = AuditLogger::diff(
            ['assigned_to' => $before['assigned_to'], 'due_date' => $before['due_date']?->format('Y-m-d')],
            ['assigned_to' => $engagementProcess->assigned_to, 'due_date' => $engagementProcess->due_date?->format('Y-m-d')],
        );
        AuditLogger::record('engagement.process_assigned', $engagementProcess, $b, $a, ['process' => $engagementProcess->process_name]);

        return response()->json(['data' => $engagementProcess->load('assignee:id,name')]);
    }

    public function removeProcess(EngagementProcess $engagementProcess): JsonResponse
    {
        if ($engagementProcess->tests()->whereNotNull('result')->exists()) {
            return response()->json(['message' => 'Testing has started on this process, so it cannot be removed.'], 422);
        }
        $engagement = $engagementProcess->engagement;
        $engagementProcess->delete();
        AuditWorkflow::refreshEngagement($engagement);
        AuditLogger::record('engagement.process_removed', $engagement, ['process' => $engagementProcess->process_name]);

        return response()->json(['success' => true]);
    }

    /**
     * Step IV — full data for the Word (detailed) and PowerPoint (summary) reports.
     * Only available once every assigned process has every control tested.
     */
    public function report(Request $request, Engagement $engagement): JsonResponse
    {
        if (AuditWorkflow::restrictedTo($request)) {
            return response()->json(['message' => 'Only managers can generate engagement reports.'], 403);
        }
        $format = $request->validate(['format' => ['required', Rule::in(['word', 'ppt'])]])['format'];
        if ($engagement->status !== 'completed') {
            return response()->json(['message' => 'Reports can be generated once every process in this engagement has been fully tested.'], 422);
        }

        $engagement->load(['client', 'processes.assignee:id,name', 'processes.tests.tester:id,name']);
        $processes = $engagement->processes->map(function (EngagementProcess $ep) {
            $tests = $ep->tests;
            $risks = $tests->groupBy(fn ($t) => $t->snapshot['risk_id'])->map(function ($group) {
                $s = $group->first()->snapshot;

                return [
                    'code' => $s['risk_code'], 'title' => $s['risk_title'], 'rating' => $s['risk_rating'], 'order' => $s['risk_order'] ?? 0,
                    'controls' => $group->map(fn ($t) => AuditWorkflow::presentTest($t))->values(),
                ];
            })->sortBy('order')->values();

            return [
                'id' => $ep->id,
                'code' => $ep->process_code,
                'name' => $ep->process_name,
                'assignee' => $ep->assignee?->name,
                'completed_at' => $ep->completed_at,
                'controls' => $tests->count(),
                'passed' => $tests->where('result', 'pass')->count(),
                'failed' => $tests->where('result', 'fail')->count(),
                'risks' => $risks,
            ];
        });

        $failedTests = $engagement->processes->flatMap->tests->where('result', 'fail');
        $byRating = collect(['high', 'medium', 'low'])->mapWithKeys(fn ($r) => [$r => $failedTests->filter(fn ($t) => ($t->snapshot['risk_rating'] ?? null) === $r)->count()]);

        AuditLogger::record('engagement.report_generated', $engagement, null, null, ['format' => $format]);

        return response()->json(['data' => [
            'firm' => $request->attributes->get('tenant')->name,
            'generated_at' => now()->toIso8601String(),
            'generated_by' => $request->user()->name,
            'engagement' => $engagement->makeHidden('processes'),
            'summary' => [
                'processes' => $processes->count(),
                'controls' => $processes->sum('controls'),
                'passed' => $processes->sum('passed'),
                'failed' => $processes->sum('failed'),
                'queries_open' => $failedTests->where('query_status', 'open')->count(),
                'queries_closed' => $failedTests->where('query_status', 'closed')->count(),
                'failed_by_rating' => $byRating,
            ],
            'processes' => $processes,
            'queries' => $failedTests->map(fn ($t) => AuditWorkflow::presentQuery($t->setRelation('engagement', $engagement)))->values(),
        ]]);
    }

    private function validated(Request $request, ?Engagement $engagement = null): array
    {
        $tenantId = $request->attributes->get('tenant')->id;
        $data = $request->validate([
            'client_id' => ['required', 'integer', Rule::exists('clients', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at')],
            'audit_type' => ['required', Rule::in(Engagement::AUDIT_TYPES)],
            'frequency' => ['required', Rule::in(Engagement::FREQUENCIES)],
            'fiscal_year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'period' => ['required', 'string'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ]);
        $data['fiscal_year'] = (int) $data['fiscal_year'];

        if (!in_array($data['period'], Engagement::periodsFor($data['frequency']), true)) {
            throw ValidationException::withMessages(['period' => 'Choose a period that matches the frequency.']);
        }

        $duplicate = Engagement::query()
            ->where('client_id', $data['client_id'])->where('audit_type', $data['audit_type'])
            ->where('fiscal_year', $data['fiscal_year'])->where('period', $data['period'])
            ->when($engagement, fn ($q) => $q->whereKeyNot($engagement->id))
            ->exists();
        if ($duplicate) {
            throw ValidationException::withMessages(['period' => 'This client already has an engagement of this type for that period.']);
        }

        return $data;
    }

    private function testerRule(int $tenantId)
    {
        return function (string $attribute, $value, \Closure $fail) use ($tenantId) {
            if ($value && !MetaController::testers($tenantId)->contains('id', (int) $value)) {
                $fail('Choose a team member who can perform testing.');
            }
        };
    }
}
