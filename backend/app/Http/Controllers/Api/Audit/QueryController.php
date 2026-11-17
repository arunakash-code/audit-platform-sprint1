<?php

namespace App\Http\Controllers\Api\Audit;

use App\Http\Controllers\Controller;
use App\Models\ControlTest;
use App\Services\AuditWorkflow;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Queries = failed control tests. "Due for retest" = open queries whose closure date has arrived (or is within the window). */
class QueryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status', 'open');
        $mine = AuditWorkflow::restrictedTo($request);
        $query = self::scoped($request, $mine)
            ->with(['engagement.client:id,name', 'engagementProcess.assignee:id,name'])
            ->when($status === 'open', fn ($q) => $q->where('query_status', 'open'))
            ->when($status === 'closed', fn ($q) => $q->where('query_status', 'closed'))
            ->when($status === 'retest_due', fn ($q) => self::dueForRetest($q))
            ->when($request->boolean('mine'), fn ($q) => $q->whereHas('engagementProcess', fn ($w) => $w->where('assigned_to', $request->user()->id)))
            ->when($request->query('search'), function ($q, $s) {
                $like = '%'.$s.'%';
                $q->where(fn ($w) => $w->where('failure_reason', 'like', $like)->orWhere('responsible_person', 'like', $like)->orWhere('snapshot', 'like', $like));
            })
            ->orderByRaw('CASE WHEN query_status = ? THEN 0 ELSE 1 END', ['open'])
            ->orderBy('target_date')
            ->limit(500);

        $rows = $query->get()->map(fn ($t) => AuditWorkflow::presentQuery($t));

        $base = self::scoped($request, $mine);
        return response()->json([
            'data' => $rows,
            'counts' => [
                'open' => (clone $base)->where('query_status', 'open')->count(),
                'retest_due' => self::dueForRetest(clone $base)->count(),
                'closed' => (clone $base)->where('query_status', 'closed')->count(),
                'all' => (clone $base)->count(),
            ],
            'window_days' => (int) config('audit.retest_window_days', 7),
        ]);
    }

    /**
     * Failed tests limited by optional client / fiscal year / period / engagement filters.
     * $assignedTo limits them to processes assigned to that user (Auditors).
     */
    public static function scoped(Request $request, ?int $assignedTo = null): Builder
    {
        return ControlTest::query()
            ->whereNotNull('query_status')
            ->when($assignedTo, fn ($q) => $q->whereHas('engagementProcess', fn ($w) => $w->where('assigned_to', $assignedTo)))
            ->whereHas('engagement', function ($q) use ($request) {
                $q->when($request->query('client_id'), fn ($w, $v) => $w->where('client_id', $v))
                    ->when($request->query('fiscal_year'), fn ($w, $v) => $w->where('fiscal_year', $v))
                    ->when($request->query('period'), fn ($w, $v) => $w->where('period', $v))
                    ->when($request->query('engagement_id'), fn ($w, $v) => $w->whereKey($v));
            });
    }

    public static function dueForRetest(Builder $q): Builder
    {
        return $q->where('query_status', 'open')
            ->whereNotNull('target_date')
            ->whereDate('target_date', '<=', now()->addDays((int) config('audit.retest_window_days', 7)));
    }
}
