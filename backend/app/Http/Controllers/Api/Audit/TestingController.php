<?php

namespace App\Http\Controllers\Api\Audit;

use App\Http\Controllers\Controller;
use App\Models\ControlTest;
use App\Models\EngagementProcess;
use App\Services\AuditLogger;
use App\Services\AuditWorkflow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Step III — the assigned resource tests each control of a process. */
class TestingController extends Controller
{
    /** Processes assigned to the signed-in user, newest period first. */
    public function myWork(Request $request): JsonResponse
    {
        $eps = EngagementProcess::with(['engagement.client:id,name', 'assignee:id,name'])
            ->where('assigned_to', $request->user()->id)
            ->whereHas('engagement')
            ->get()
            ->sortBy([fn ($a, $b) => strcmp((string) $b->engagement->period_start, (string) $a->engagement->period_start)]);
        $counts = AuditWorkflow::processCounts($eps->pluck('id')->all());

        return response()->json(['data' => $eps->map(fn ($ep) => AuditWorkflow::presentProcess($ep, $counts[$ep->id] ?? []) + [
            'client' => $ep->engagement->client?->name,
            'engagement_label' => $ep->engagement->label,
        ])->values()]);
    }

    /** Testing workspace: process → risks → controls (with checks and results). */
    public function showProcess(Request $request, EngagementProcess $engagementProcess): JsonResponse
    {
        $mine = AuditWorkflow::restrictedTo($request);
        if ($mine && (int) $engagementProcess->assigned_to !== $mine) {
            return response()->json(['message' => 'This process is not assigned to you.'], 403);
        }
        $ep = $engagementProcess->load(['engagement.client:id,name', 'assignee:id,name', 'tests.tester:id,name']);
        $counts = AuditWorkflow::processCounts([$ep->id]);

        $risks = $ep->tests->groupBy(fn ($t) => $t->snapshot['risk_id'])->map(function ($group) {
            $s = $group->first()->snapshot;

            return [
                'risk_id' => $s['risk_id'],
                'code' => $s['risk_code'],
                'title' => $s['risk_title'],
                'description' => $s['risk_description'] ?? null,
                'rating' => $s['risk_rating'],
                'order' => $s['risk_order'] ?? 0,
                'controls' => $group->map(fn ($t) => AuditWorkflow::presentTest($t))->values(),
            ];
        })->sortBy('order')->values();

        return response()->json(['data' => [
            'process' => AuditWorkflow::presentProcess($ep, $counts[$ep->id] ?? []),
            'engagement' => $ep->engagement->only(['id', 'label', 'fy_label', 'period', 'audit_type', 'status', 'period_start', 'period_end']) + ['client' => $ep->engagement->client?->name],
            'risks' => $risks,
            'can_test' => AuditWorkflow::canTest($request, $ep),
        ]]);
    }

    /**
     * Record testing. Each check carries its own population, samples tested, pass/fail
     * and notes. A check without Pass/Fail must say why it was not tested. The control's
     * result is derived: any failed check fails it (raising a query); otherwise it passes
     * when at least one check passed.
     * Controls without checks are recorded at control level.
     */
    public function update(Request $request, ControlTest $controlTest): JsonResponse
    {
        $ep = $controlTest->engagementProcess;
        if (!AuditWorkflow::canTest($request, $ep)) {
            return response()->json(['message' => 'Only the person assigned to this process (or a manager) can record testing.'], 403);
        }
        if (!empty($controlTest->retests)) {
            return response()->json(['message' => 'This query already has retest history. Record a retest instead of changing the original result.'], 422);
        }

        $checks = collect($controlTest->snapshot['checks'] ?? [])->values();
        $checkIds = $checks->pluck('id')->map(fn ($id) => (string) $id)->all();
        $perCheck = count($checkIds) > 0;

        $rules = [
            'test_notes' => ['nullable', 'string', 'max:5000'],
            'failure_reason' => ['nullable', 'string', 'max:5000'],
            'failed_samples' => ['nullable', 'integer', 'min:1'],
            'management_response' => ['nullable', 'string', 'max:5000'],
            'target_date' => ['nullable', 'date'],
            'responsible_person' => ['nullable', 'string', 'max:150'],
        ];
        if ($perCheck) {
            $rules += [
                'check_results' => ['nullable', 'array'],
                'check_results.*' => ['array'],
                'check_results.*.population' => ['nullable', 'integer', 'min:0', 'max:1000000000'],
                'check_results.*.sample_size' => ['nullable', 'integer', 'min:0', 'max:1000000000'],
                'check_results.*.result' => ['nullable', Rule::in(ControlTest::RESULTS)],
                'check_results.*.notes' => ['nullable', 'string', 'max:5000'],
            ];
        } else {
            $rules += [
                'population' => ['nullable', 'integer', 'min:0', 'max:1000000000', 'required_with:result'],
                'sample_size' => ['nullable', 'integer', 'min:0', 'max:1000000000', 'required_with:result'],
                'result' => ['nullable', Rule::in(ControlTest::RESULTS)],
            ];
        }
        $input = $request->validate($rules, [
            'population.required_with' => 'Enter the total population before recording a result.',
            'sample_size.required_with' => 'Enter how many samples were tested.',
        ]);

        $errors = [];
        $data = ['test_notes' => $input['test_notes'] ?? null];

        if ($perCheck) {
            // Keep only known checks, in the checklist's order.
            $raw = $input['check_results'] ?? [];
            $rows = [];
            foreach ($checks as $i => $check) {
                $id = (string) $check['id'];
                $r = $raw[$id] ?? [];
                $row = [
                    'population' => isset($r['population']) ? (int) $r['population'] : null,
                    'sample_size' => isset($r['sample_size']) ? (int) $r['sample_size'] : null,
                    'result' => $r['result'] ?? null,
                    'notes' => isset($r['notes']) && trim((string) $r['notes']) !== '' ? trim((string) $r['notes']) : null,
                ];
                $n = $i + 1;
                if ($row['result'] && $row['population'] === null) {
                    $errors["check_results.$id.population"] = "Check $n: enter the total population before recording a result.";
                }
                if ($row['result'] && $row['sample_size'] === null) {
                    $errors["check_results.$id.sample_size"] = "Check $n: enter how many samples were tested.";
                }
                if (!$row['result'] && $row['notes'] === null) {
                    $errors["check_results.$id.notes"] = "Check $n: select Pass or Fail, or explain why this check was not tested.";
                }
                if ($row['population'] !== null && $row['sample_size'] !== null && $row['sample_size'] > $row['population']) {
                    $errors["check_results.$id.sample_size"] = "Check $n: samples tested cannot be larger than the population.";
                }
                if (array_filter($row, fn ($v) => $v !== null)) {
                    $rows[$id] = $row;
                }
            }

            $results = collect($checkIds)->map(fn ($id) => $rows[$id]['result'] ?? null);
            $data['check_results'] = $rows;
            // Any failed check fails the control (and raises a query). Otherwise it passes once at least one
            // check has passed and every other check carries a reason for not being tested.
            $data['result'] = $results->contains('fail') ? 'fail' : ($results->contains('pass') ? 'pass' : null);
            // Control-level figures for lists, dashboards and reports: the largest population and sample across checks.
            $tested = collect($rows)->filter(fn ($r) => $r['result'] !== null);
            $data['population'] = $tested->max('population');
            $data['sample_size'] = $tested->max('sample_size');
            $failedSampleCap = collect($rows)->where('result', 'fail')->sum('sample_size');
        } else {
            $data += [
                'population' => $input['population'] ?? null,
                'sample_size' => $input['sample_size'] ?? null,
                'result' => $input['result'] ?? null,
                'check_results' => [],
            ];
            if (isset($data['population'], $data['sample_size']) && $data['sample_size'] > $data['population']) {
                $errors['sample_size'] = 'The sample cannot be larger than the population.';
            }
            $failedSampleCap = $data['sample_size'] ?? 0;
        }

        if ($data['result'] === 'fail') {
            foreach (['failure_reason', 'failed_samples', 'management_response', 'target_date', 'responsible_person'] as $f) {
                if (($input[$f] ?? null) === null || $input[$f] === '') {
                    $errors[$f] = 'Required when the control fails.';
                }
                $data[$f] = $input[$f] ?? null;
            }
            if (($input['failed_samples'] ?? null) !== null && $input['failed_samples'] > $failedSampleCap) {
                $errors['failed_samples'] = $perCheck
                    ? "Failed samples cannot exceed the samples tested on the failed checks ($failedSampleCap)."
                    : 'Failed samples cannot exceed the samples tested.';
            }
        } else {
            // Passing (or not yet complete) controls carry no query.
            $data = array_merge($data, array_fill_keys(['failure_reason', 'failed_samples', 'management_response', 'target_date', 'responsible_person'], null));
        }

        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $before = $controlTest->only(['population', 'sample_size', 'result', 'failure_reason', 'failed_samples', 'management_response', 'target_date', 'responsible_person']);
        $before['target_date'] = $controlTest->target_date?->format('Y-m-d');

        $controlTest->fill($data);
        if ($controlTest->isDirty('result')) {
            $controlTest->tested_by = $controlTest->result ? $request->user()->id : null;
            $controlTest->tested_at = $controlTest->result ? now() : null;
        }
        $controlTest->query_status = $controlTest->result === 'fail' ? 'open' : null;
        $controlTest->save();

        AuditWorkflow::refreshProcess($ep);
        AuditWorkflow::refreshEngagement($ep->engagement);

        $after = $controlTest->only(array_keys($before));
        $after['target_date'] = $controlTest->target_date?->format('Y-m-d');
        [$b, $a] = AuditLogger::diff($before, $after);
        if ($b || $a) {
            AuditLogger::record(
                $before['result'] !== 'fail' && $controlTest->result === 'fail' ? 'testing.query_raised' : 'testing.recorded',
                $controlTest, $b, $a,
                ['control' => $controlTest->snapshot['control_code'] ?? null, 'process' => $ep->process_name],
            );
        }

        return response()->json(['data' => [
            'test' => AuditWorkflow::presentTest($controlTest->load('tester:id,name')),
            'process_status' => $ep->fresh()->status,
        ]]);
    }

    /** Retest an open query on/after its closure date. Pass closes it; fail keeps it open with a new date. */
    public function retest(Request $request, ControlTest $controlTest): JsonResponse
    {
        if (!AuditWorkflow::canTest($request, $controlTest->engagementProcess)) {
            return response()->json(['message' => 'Only the person assigned to this process (or a manager) can retest it.'], 403);
        }
        if ($controlTest->query_status !== 'open') {
            return response()->json(['message' => 'Only open queries can be retested.'], 422);
        }

        $data = $request->validate([
            'result' => ['required', Rule::in(ControlTest::RESULTS)],
            'sample_size' => ['nullable', 'integer', 'min:0'],
            'notes' => ['required', 'string', 'max:5000'],
            'new_target_date' => ['nullable', 'required_if:result,fail', 'date', 'after:today'],
        ], ['new_target_date.required_if' => 'Set a new closure date when the retest fails.']);

        $entry = [
            'at' => now()->toIso8601String(),
            'by' => $request->user()->name,
            'by_id' => $request->user()->id,
            'result' => $data['result'],
            'sample_size' => $data['sample_size'] ?? null,
            'notes' => $data['notes'],
            'previous_target_date' => $controlTest->target_date?->format('Y-m-d'),
        ];
        $controlTest->retests = [...($controlTest->retests ?? []), $entry];

        if ($data['result'] === 'pass') {
            $controlTest->query_status = 'closed';
            $controlTest->closed_at = now();
        } else {
            $controlTest->target_date = $data['new_target_date'];
        }
        $controlTest->save();

        AuditLogger::record(
            $data['result'] === 'pass' ? 'testing.query_closed' : 'testing.retest_failed',
            $controlTest,
            ['query_status' => 'open', 'target_date' => $entry['previous_target_date']],
            ['query_status' => $controlTest->query_status, 'target_date' => $controlTest->target_date?->format('Y-m-d')],
            ['reference' => $controlTest->reference()],
        );

        return response()->json(['data' => AuditWorkflow::presentTest($controlTest->load('tester:id,name'))]);
    }
}
