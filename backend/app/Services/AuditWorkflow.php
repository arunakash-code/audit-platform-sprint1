<?php

namespace App\Services;

use App\Models\AuditProcess;
use App\Models\ControlTest;
use App\Models\Engagement;
use App\Models\EngagementProcess;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Engagement workflow rules:
 *  - Step II: adding a process copies every control of that process (with its risk and checks) into control_tests.
 *  - Step IV: a process is complete only when every control has a pass/fail result;
 *             an engagement is complete only when every assigned process is complete.
 */
class AuditWorkflow
{
    /** Permission check against the current tenant, memoised per request. */
    public static function can(Request $request, string $permission): bool
    {
        $perms = $request->attributes->get('_audit_perms');
        if ($perms === null) {
            $perms = $request->user()?->permissionsIn($request->attributes->get('tenant')) ?? [];
            $request->attributes->set('_audit_perms', $perms);
        }

        return in_array($permission, $perms, true);
    }

    /** Managers can work on any process; testers only on processes assigned to them. */
    public static function canTest(Request $request, EngagementProcess $ep): bool
    {
        if (self::can($request, 'audit.manage')) {
            return true;
        }

        return self::can($request, 'audit.test') && (int) $ep->assigned_to === (int) $request->user()->id;
    }

    /** Step II — add processes from the RCM library to an engagement. */
    public static function addProcesses(Engagement $engagement, array $processIds, ?int $assignedTo, ?string $dueDate): Collection
    {
        return DB::transaction(function () use ($engagement, $processIds, $assignedTo, $dueDate) {
            $processes = AuditProcess::with('risks.controls.checks')->whereIn('id', $processIds)->orderBy('sort_order')->get();
            $existing = $engagement->processes()->pluck('process_id')->all();
            $created = collect();

            foreach ($processes as $process) {
                if (in_array($process->id, $existing, true)) {
                    continue;
                }
                $ep = $engagement->processes()->create([
                    'tenant_id' => $engagement->tenant_id,
                    'process_id' => $process->id,
                    'process_code' => $process->code,
                    'process_name' => $process->name,
                    'assigned_to' => $assignedTo,
                    'due_date' => $dueDate,
                    'status' => 'not_started',
                ]);

                $order = 0;
                foreach ($process->risks as $ri => $risk) {
                    foreach ($risk->controls as $control) {
                        ControlTest::create([
                            'tenant_id' => $engagement->tenant_id,
                            'engagement_id' => $engagement->id,
                            'engagement_process_id' => $ep->id,
                            'control_id' => $control->id,
                            'sort_order' => $order++,
                            'snapshot' => [
                                'risk_id' => $risk->id,
                                'risk_code' => $risk->code,
                                'risk_title' => $risk->title,
                                'risk_description' => $risk->description,
                                'risk_rating' => $risk->rating,
                                'risk_order' => $ri,
                                'control_code' => $control->code,
                                'control_title' => $control->title,
                                'control_description' => $control->description,
                                'nature' => $control->nature,
                                'control_type' => $control->control_type,
                                'frequency' => $control->frequency,
                                'owner' => $control->owner,
                                'is_key' => $control->is_key,
                                'checks' => $control->checks->map(fn ($c) => ['id' => $c->id, 'description' => $c->description])->values()->all(),
                            ],
                        ]);
                    }
                }
                self::refreshProcess($ep);
                $created->push($ep);
            }
            self::refreshEngagement($engagement);

            return $created;
        });
    }

    public static function refreshProcess(EngagementProcess $ep): void
    {
        $total = $ep->tests()->count();
        $tested = $ep->tests()->whereNotNull('result')->count();

        $status = $total > 0 && $tested === $total ? 'completed' : ($tested > 0 ? 'in_progress' : 'not_started');
        $ep->status = $status;
        if ($tested > 0 && !$ep->started_at) {
            $ep->started_at = now();
        }
        $ep->completed_at = $status === 'completed' ? ($ep->completed_at ?? now()) : null;
        $ep->save();
    }

    public static function refreshEngagement(Engagement $engagement): void
    {
        $statuses = $engagement->processes()->pluck('status');
        $status = match (true) {
            $statuses->isNotEmpty() && $statuses->every(fn ($s) => $s === 'completed') => 'completed',
            $statuses->contains(fn ($s) => $s !== 'not_started') => 'in_progress',
            default => 'planning',
        };
        $engagement->status = $status;
        $engagement->completed_at = $status === 'completed' ? ($engagement->completed_at ?? now()) : null;
        $engagement->save();
    }

    /** Per-engagement-process control counts: [ep_id => [total, tested, passed, failed, open_queries]]. */
    public static function processCounts(array $epIds): Collection
    {
        if (!$epIds) {
            return collect();
        }

        return ControlTest::query()
            ->whereIn('engagement_process_id', $epIds)
            ->groupBy('engagement_process_id')
            ->selectRaw('engagement_process_id,
                COUNT(*) as total,
                SUM(CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END) as tested,
                SUM(CASE WHEN result = ? THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN result = ? THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN query_status = ? THEN 1 ELSE 0 END) as open_queries', ['pass', 'fail', 'open'])
            ->get()
            ->keyBy('engagement_process_id')
            ->map(fn ($r) => [
                'total' => (int) $r->total, 'tested' => (int) $r->tested, 'passed' => (int) $r->passed,
                'failed' => (int) $r->failed, 'open_queries' => (int) $r->open_queries,
            ]);
    }

    public static function presentProcess(EngagementProcess $ep, array $counts): array
    {
        return [
            'id' => $ep->id,
            'engagement_id' => $ep->engagement_id,
            'process_id' => $ep->process_id,
            'process_code' => $ep->process_code,
            'process_name' => $ep->process_name,
            'status' => $ep->status,
            'due_date' => $ep->due_date?->format('Y-m-d'),
            'completed_at' => $ep->completed_at,
            'assignee' => $ep->assignee ? ['id' => $ep->assignee->id, 'name' => $ep->assignee->name] : null,
            'counts' => $counts + ['total' => 0, 'tested' => 0, 'passed' => 0, 'failed' => 0, 'open_queries' => 0],
        ];
    }

    /**
     * Per-check testing data keyed by check id: population, sample_size, result, notes.
     * Older records stored a plain "done" boolean per check; those inherit the
     * control-level figures so historical results still display correctly.
     */
    public static function checkResults(ControlTest $t): array
    {
        $out = [];
        foreach (($t->check_results ?? []) as $id => $value) {
            if (is_array($value)) {
                $out[(string) $id] = [
                    'population' => isset($value['population']) ? (int) $value['population'] : null,
                    'sample_size' => isset($value['sample_size']) ? (int) $value['sample_size'] : null,
                    'result' => in_array($value['result'] ?? null, ControlTest::RESULTS, true) ? $value['result'] : null,
                    'notes' => isset($value['notes']) && $value['notes'] !== '' ? (string) $value['notes'] : null,
                ];
            } elseif ($value) {
                $out[(string) $id] = [
                    'population' => $t->population,
                    'sample_size' => $t->sample_size,
                    'result' => $t->result,
                    'notes' => null,
                ];
            }
        }

        return $out;
    }

    public static function presentTest(ControlTest $t): array
    {
        return [
            'id' => $t->id,
            'reference' => $t->reference(),
            'engagement_process_id' => $t->engagement_process_id,
            'snapshot' => $t->snapshot,
            'population' => $t->population,
            'sample_size' => $t->sample_size,
            'result' => $t->result,
            'check_results' => (object) self::checkResults($t),
            'test_notes' => $t->test_notes,
            'tested_by' => $t->tester ? ['id' => $t->tester->id, 'name' => $t->tester->name] : null,
            'tested_at' => $t->tested_at,
            'failure_reason' => $t->failure_reason,
            'failed_samples' => $t->failed_samples,
            'management_response' => $t->management_response,
            'target_date' => $t->target_date?->format('Y-m-d'),
            'responsible_person' => $t->responsible_person,
            'query_status' => $t->query_status,
            'retests' => $t->retests ?? [],
            'closed_at' => $t->closed_at,
            'updated_at' => $t->updated_at,
        ];
    }

    /** Flat query row (a failed control) with its engagement context. */
    public static function presentQuery(ControlTest $t): array
    {
        $ep = $t->engagementProcess;
        $e = $t->engagement;
        $s = $t->snapshot;
        $days = $t->target_date ? (int) now()->startOfDay()->diffInDays($t->target_date, false) : null;

        return [
            'id' => $t->id,
            'reference' => $t->reference(),
            'client' => $e?->client?->name,
            'engagement_id' => $t->engagement_id,
            'engagement_label' => $e?->label,
            'engagement_process_id' => $t->engagement_process_id,
            'process_name' => $ep?->process_name,
            'assignee' => $ep?->assignee?->name,
            'assigned_to' => $ep?->assigned_to,
            'risk_title' => $s['risk_title'] ?? null,
            'risk_rating' => $s['risk_rating'] ?? null,
            'control_code' => $s['control_code'] ?? null,
            'control_title' => $s['control_title'] ?? null,
            'sample_size' => $t->sample_size,
            'failed_samples' => $t->failed_samples,
            'failure_reason' => $t->failure_reason,
            'management_response' => $t->management_response,
            'responsible_person' => $t->responsible_person,
            'target_date' => $t->target_date?->format('Y-m-d'),
            'days_to_target' => $days,
            'query_status' => $t->query_status,
            'retest_count' => count($t->retests ?? []),
            'retests' => $t->retests ?? [],
            'tested_at' => $t->tested_at,
            'closed_at' => $t->closed_at,
        ];
    }
}
