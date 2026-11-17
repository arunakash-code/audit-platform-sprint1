<?php

namespace Database\Seeders;

use App\Models\Tenant;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Maps the deployed hostnames (comma-separated TENANT_HOSTS env var) to the
 * default tenant so ResolveTenant can find it. Safe to run on every deploy.
 */
class TenantHostsSeeder extends Seeder
{
    public function run(): void
    {
        $hosts = array_filter(array_map(
            fn ($h) => strtolower(trim($h)),
            explode(',', (string) env('TENANT_HOSTS', ''))
        ));

        if (! $hosts) {
            return;
        }

        $tenant = Tenant::query()
            ->where('slug', env('DEFAULT_TENANT_SLUG', 'demo-firm'))
            ->first() ?? Tenant::query()->orderBy('id')->first();

        if (! $tenant) {
            $this->command?->warn('No tenant yet — run the main seeder first (SEED_ON_START=true).');
            return;
        }

        foreach ($hosts as $host) {
            DB::table('tenant_domains')->updateOrInsert(
                ['host' => $host],
                ['tenant_id' => $tenant->id, 'is_verified' => true, 'updated_at' => now(), 'created_at' => now()]
            );
        }
    }
}
