<?php

namespace Tests\Feature;

use App\Models\ControlTest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Each check records its own population, samples, result and notes; the control result is derived. */
class PerCheckTestingTest extends TestCase
{
    use RefreshDatabase;

    protected bool $seed = true;

    private function untestedControl(): ControlTest
    {
        return ControlTest::withoutGlobalScopes()
            ->whereNull('result')
            ->get()
            ->first(fn ($t) => count($t->snapshot['checks'] ?? []) >= 2);
    }

    private function saveTest(ControlTest $t, array $payload)
    {
        $owner = User::where('email', 'owner@example.test')->first();

        return $this->actingAs($owner)
            ->withHeaders(['Accept' => 'application/json'])
            ->putJson("http://localhost/api/v1/audit/control-tests/{$t->id}", $payload);
    }

    public function test_untested_checks_need_a_reason_and_all_pass_passes_it(): void
    {
        $t = $this->untestedControl();
        $ids = collect($t->snapshot['checks'])->pluck('id')->map(fn ($i) => (string) $i)->all();

        // A check left without Pass/Fail must explain why.
        $partial = [$ids[0] => ['population' => 10, 'sample_size' => 8, 'result' => 'pass', 'notes' => 'All passed']];
        $this->saveTest($t, ['check_results' => $partial])
            ->assertStatus(422)
            ->assertJsonValidationErrors(["check_results.{$ids[1]}.notes"]);

        $withReasons = $partial + collect(array_slice($ids, 1))->mapWithKeys(fn ($id) => [$id => ['notes' => 'No duplicates flagged in the period']])->all();
        $this->saveTest($t, ['check_results' => $withReasons])
            ->assertOk()
            ->assertJsonPath('data.test.result', 'pass')
            ->assertJsonPath("data.test.check_results.{$ids[0]}.sample_size", 8)
            ->assertJsonPath("data.test.check_results.{$ids[1]}.result", null)
            ->assertJsonPath("data.test.check_results.{$ids[1]}.notes", 'No duplicates flagged in the period');

        // Every check given only a reason (none tested) leaves the control untested.
        $none = collect($ids)->mapWithKeys(fn ($id) => [$id => ['notes' => 'Not applicable this period']])->all();
        $this->saveTest($t, ['check_results' => $none])->assertOk()->assertJsonPath('data.test.result', null);

        $all = collect($ids)->mapWithKeys(fn ($id, $i) => [$id => ['population' => 20 + $i, 'sample_size' => 5 + $i, 'result' => 'pass']])->all();
        $this->saveTest($t, ['check_results' => $all])
            ->assertOk()
            ->assertJsonPath('data.test.result', 'pass')
            ->assertJsonPath('data.test.population', 20 + count($ids) - 1)
            ->assertJsonPath('data.test.query_status', null);
    }

    public function test_a_failed_check_fails_the_control_and_needs_query_details(): void
    {
        $t = $this->untestedControl();
        $ids = collect($t->snapshot['checks'])->pluck('id')->map(fn ($i) => (string) $i)->all();
        $checks = collect($ids)->mapWithKeys(fn ($id) => [$id => ['notes' => 'Not required this period']])->all();
        $checks[$ids[0]] = ['population' => 10, 'sample_size' => 8, 'result' => 'pass'];
        $checks[$ids[1]] = ['population' => 12, 'sample_size' => 4, 'result' => 'fail', 'notes' => '1 missing approval'];

        $this->saveTest($t, ['check_results' => $checks])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['failure_reason', 'failed_samples', 'management_response', 'target_date', 'responsible_person']);

        $this->saveTest($t, ['check_results' => $checks, 'failure_reason' => 'Approval missing', 'failed_samples' => 5,
            'management_response' => 'Will fix', 'target_date' => now()->addDays(10)->toDateString(), 'responsible_person' => 'AP lead'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['failed_samples']);

        $this->saveTest($t, ['check_results' => $checks, 'failure_reason' => 'Approval missing', 'failed_samples' => 1,
            'management_response' => 'Will fix', 'target_date' => now()->addDays(10)->toDateString(), 'responsible_person' => 'AP lead'])
            ->assertOk()
            ->assertJsonPath('data.test.result', 'fail')
            ->assertJsonPath('data.test.query_status', 'open')
            ->assertJsonPath("data.test.check_results.{$ids[1]}.result", 'fail');
    }

    public function test_check_figures_are_validated(): void
    {
        $t = $this->untestedControl();
        $id = (string) $t->snapshot['checks'][0]['id'];

        $this->saveTest($t, ['check_results' => [$id => ['population' => 5, 'sample_size' => 9, 'result' => 'pass']]])
            ->assertStatus(422)->assertJsonValidationErrors(["check_results.$id.sample_size"]);

        $this->saveTest($t, ['check_results' => [$id => ['result' => 'pass']]])
            ->assertStatus(422)->assertJsonValidationErrors(["check_results.$id.population", "check_results.$id.sample_size"]);
    }

    public function test_legacy_boolean_checks_are_presented_with_control_figures(): void
    {
        $t = $this->untestedControl();
        $id = (string) $t->snapshot['checks'][0]['id'];
        $t->forceFill(['population' => 30, 'sample_size' => 6, 'result' => 'pass', 'check_results' => [$id => true]])->save();

        $owner = User::where('email', 'owner@example.test')->first();
        $this->actingAs($owner)->getJson("http://localhost/api/v1/audit/engagement-processes/{$t->engagement_process_id}")
            ->assertOk()
            ->assertJsonFragment(['population' => 30, 'sample_size' => 6, 'result' => 'pass', 'notes' => null]);
    }
}
