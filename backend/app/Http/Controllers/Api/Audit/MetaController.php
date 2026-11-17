<?php

namespace App\Http\Controllers\Api\Audit;

use App\Http\Controllers\Controller;
use App\Models\AuditControl;
use App\Models\AuditProcess;
use App\Models\AuditRisk;
use App\Models\Client;
use App\Models\Engagement;
use App\Services\AuditWorkflow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Lookups shared by the audit workspace screens (dropdowns, option lists). */
class MetaController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $tenant = $request->attributes->get('tenant');
        $today = now();
        $fy = Engagement::fiscalYearOf($today);

        return response()->json(['data' => [
            'clients' => Client::query()->where('status', 'active')
                ->when(AuditWorkflow::restrictedTo($request), fn ($q, $mine) => $q->whereHas('engagements.processes', fn ($w) => $w->where('assigned_to', $mine)))
                ->orderBy('name')->get(['id', 'name', 'code']),
            'processes' => AuditProcess::query()
                ->withCount(['risks', 'controls'])
                ->orderBy('sort_order')->orderBy('name')
                ->get(['id', 'code', 'name']),
            'testers' => self::testers($tenant->id),
            'options' => [
                'audit_types' => Engagement::AUDIT_TYPES,
                'frequencies' => Engagement::FREQUENCIES,
                'periods' => ['quarterly' => Engagement::periodsFor('quarterly'), 'annual' => Engagement::periodsFor('annual')],
                'fiscal_years' => collect(range($fy - 3, $fy + 1))->map(fn ($y) => ['value' => $y, 'label' => Engagement::fyLabelFor($y)])->reverse()->values(),
                'current_fiscal_year' => $fy,
                'fy_start_month' => Engagement::fyStartMonth(),
                'risk_ratings' => AuditRisk::RATINGS,
                'control_natures' => AuditControl::NATURES,
                'control_types' => AuditControl::TYPES,
                'control_frequencies' => AuditControl::FREQUENCIES,
            ],
        ]]);
    }

    /** Active members who can be assigned testing work (hold audit.test or audit.manage). */
    public static function testers(int $tenantId)
    {
        return DB::table('users')
            ->join('tenant_user', fn ($j) => $j->on('tenant_user.user_id', '=', 'users.id')->where('tenant_user.tenant_id', $tenantId)->where('tenant_user.status', 'active'))
            ->join('tenant_user_roles', fn ($j) => $j->on('tenant_user_roles.user_id', '=', 'users.id')->where('tenant_user_roles.tenant_id', $tenantId))
            ->join('role_permissions', 'role_permissions.role_id', '=', 'tenant_user_roles.role_id')
            ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
            ->whereIn('permissions.name', ['audit.test', 'audit.manage'])
            ->whereNull('users.deleted_at')
            ->where('users.is_active', true)
            ->distinct()
            ->orderBy('users.name')
            ->get(['users.id', 'users.name', 'users.email']);
    }
}
