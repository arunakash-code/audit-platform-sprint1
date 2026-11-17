<?php

namespace Tests\Feature;

use App\Models\EngagementProcess;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Auditors (no audit.manage) only see processes, engagements and queries assigned to them. */
class AuditorVisibilityTest extends TestCase
{
    use RefreshDatabase;

    protected bool $seed = true;

    private function api(string $email, string $uri)
    {
        return $this->actingAs(User::where('email', $email)->first())
            ->getJson("http://localhost/api/v1/audit/$uri");
    }

    private function auditorId(): int
    {
        return User::where('email', 'auditor@example.test')->value('id');
    }

    public function test_engagements_list_and_detail_only_show_own_work(): void
    {
        $id = $this->auditorId();
        $list = $this->api('auditor@example.test', 'engagements')->assertOk()->json('data');
        $this->assertNotEmpty($list);

        $mineIds = EngagementProcess::withoutGlobalScopes()->where('assigned_to', $id)->pluck('engagement_id')->unique()->sort()->values()->all();
        $this->assertEqualsCanonicalizing($mineIds, collect($list)->pluck('id')->all());

        foreach ($list as $e) {
            $own = EngagementProcess::withoutGlobalScopes()->where('engagement_id', $e['id'])->where('assigned_to', $id)->count();
            $this->assertSame($own, $e['processes_count']);
            $detail = $this->api('auditor@example.test', "engagements/{$e['id']}")->assertOk()->json('data.processes');
            $this->assertNotEmpty($detail);
            foreach ($detail as $p) {
                $this->assertSame($id, $p['assignee']['id']);
            }
        }

        // An engagement with no work for this auditor is hidden.
        $other = EngagementProcess::withoutGlobalScopes()->whereNotIn('engagement_id', $mineIds)->value('engagement_id');
        if ($other) {
            $this->api('auditor@example.test', "engagements/$other")->assertNotFound();
        }

        // Managers still see everything.
        $all = $this->api('manager@example.test', 'engagements')->assertOk()->json('data');
        $this->assertGreaterThanOrEqual(count($list), count($all));
    }

    public function test_other_peoples_processes_are_blocked(): void
    {
        $id = $this->auditorId();
        $others = EngagementProcess::withoutGlobalScopes()->where('assigned_to', '!=', $id)->first();
        $own = EngagementProcess::withoutGlobalScopes()->where('assigned_to', $id)->first();

        $this->api('auditor@example.test', "engagement-processes/{$others->id}")->assertForbidden();
        $this->api('auditor@example.test', "engagement-processes/{$own->id}")->assertOk();
        $this->api('manager@example.test', "engagement-processes/{$others->id}")->assertOk();
    }

    public function test_queries_and_dashboard_only_include_own_processes(): void
    {
        $id = $this->auditorId();
        $ownEps = EngagementProcess::withoutGlobalScopes()->where('assigned_to', $id)->pluck('id')->all();

        $queries = $this->api('auditor@example.test', 'queries?status=all')->assertOk()->json('data');
        foreach ($queries as $q) {
            $this->assertContains($q['engagement_process_id'], $ownEps);
        }

        $dash = $this->api('auditor@example.test', 'dashboard')->assertOk()->json('data');
        foreach ($dash['processes'] as $p) {
            $this->assertSame($id, $p['assignee']['id']);
        }
        foreach ([...$dash['queries'], ...$dash['retest']] as $q) {
            $this->assertContains($q['engagement_process_id'], $ownEps);
        }

        $managerQueries = $this->api('manager@example.test', 'queries?status=all')->assertOk()->json('data');
        $this->assertGreaterThan(count($queries), count($managerQueries));
    }

    public function test_auditors_cannot_generate_reports(): void
    {
        $engagementId = EngagementProcess::withoutGlobalScopes()->where('assigned_to', $this->auditorId())->value('engagement_id');
        $this->api('auditor@example.test', "engagements/$engagementId/report?format=word")->assertForbidden();
    }
}
