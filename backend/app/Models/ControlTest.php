<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One control tested within an engagement process. A failed test is a "query" until a passing retest closes it. */
class ControlTest extends Model
{
    use BelongsToTenant;

    public const RESULTS = ['pass', 'fail'];
    public const AGREEMENTS = ['agreed', 'partially_agreed', 'not_agreed'];

    protected $fillable = [
        'tenant_id', 'engagement_id', 'engagement_process_id', 'control_id', 'snapshot', 'sort_order',
        'population', 'sample_size', 'result', 'check_results', 'test_notes', 'tested_by', 'tested_at',
        'failure_reason', 'failed_samples', 'management_response', 'recommendation', 'management_agreement', 'target_date', 'responsible_person',
        'query_status', 'retests', 'closed_at',
    ];

    protected function casts(): array
    {
        return [
            'snapshot' => 'array',
            'check_results' => 'array',
            'retests' => 'array',
            'population' => 'integer',
            'sample_size' => 'integer',
            'failed_samples' => 'integer',
            'target_date' => 'date:Y-m-d',
            'tested_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function engagement(): BelongsTo
    {
        return $this->belongsTo(Engagement::class);
    }

    public function engagementProcess(): BelongsTo
    {
        return $this->belongsTo(EngagementProcess::class);
    }

    public function tester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'tested_by')->withTrashed();
    }

    /** Query reference shown to users, e.g. Q-0042. */
    public function reference(): string
    {
        return sprintf('Q-%04d', $this->id);
    }
}
