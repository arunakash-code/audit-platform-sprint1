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

    public function test_partial_checks_leave_control_untested_and_all_pass_passes_it(): void
    {
        $t = $this->untestedControl();
        $ids = collect($t->snapshot['checks'])->pluck('id')->map(fn ($i) => (string) $i)->all();

        $partial = [$ids[0] => ['population' => 10, 'sample_size' => 8, 'result' => 'pass', 'notes' => 'All passed']];
        $this->saveTest($t, ['check_results' => $partial])
            ->assertOk()
            ->assertJsonPath('data.test.result', null)
            ->assertJsonPath("data.test.check_results.{$ids[0]}.sample_size", 8)
            ->assertJsonPath("data.test.check_results.{$ids[0]}.notes", 'All passed');

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
        $checks = [
            $ids[0] => ['population' => 10, 'sample_size' => 8, 'result' => 'pass'],
            $ids[1] => ['population' => 12, 'sample_size' => 4, 'result' => 'fail', 'notes' => '1 missing approval'],
        ];

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
