<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Engagement extends Model
{
    use BelongsToTenant, SoftDeletes;

    public const AUDIT_TYPES = ['statutory', 'internal'];
    public const FREQUENCIES = ['quarterly', 'annual'];
    public const STATUSES = ['planning', 'in_progress', 'completed'];

    protected $fillable = [
        'tenant_id', 'client_id', 'audit_type', 'frequency', 'fiscal_year', 'period',
        'period_start', 'period_end', 'status', 'notes', 'report_details', 'created_by', 'completed_at',
    ];

    protected $appends = ['label', 'fy_label'];

    protected function casts(): array
    {
        return [
            'fiscal_year' => 'integer',
            'period_start' => 'date:Y-m-d',
            'period_end' => 'date:Y-m-d',
            'completed_at' => 'datetime',
            'report_details' => 'array',
        ];
    }

    /** First month of the fiscal year (4 = April). Set AUDIT_FY_START_MONTH to change. */
    public static function fyStartMonth(): int
    {
        return (int) config('audit.fy_start_month', 4);
    }

    public static function periodsFor(string $frequency): array
    {
        return $frequency === 'quarterly' ? ['Q1', 'Q2', 'Q3', 'Q4'] : ['FY'];
    }

    public static function fyLabelFor(int $year): string
    {
        return self::fyStartMonth() === 1 ? "FY $year" : sprintf('FY %d-%02d', $year, ($year + 1) % 100);
    }

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable} */
    public static function periodDates(int $fiscalYear, string $period): array
    {
        $fyStart = CarbonImmutable::create($fiscalYear, self::fyStartMonth(), 1);
        if ($period === 'FY') {
            return [$fyStart, $fyStart->addYear()->subDay()];
        }
        $start = $fyStart->addMonths(((int) substr($period, 1) - 1) * 3);

        return [$start, $start->addMonths(3)->subDay()];
    }

    /** Fiscal year that contains the given date. */
    public static function fiscalYearOf(\DateTimeInterface $date): int
    {
        $y = (int) $date->format('Y');

        return (int) $date->format('n') >= self::fyStartMonth() ? $y : $y - 1;
    }

    public function getFyLabelAttribute(): string
    {
        return self::fyLabelFor((int) $this->fiscal_year);
    }

    public function getLabelAttribute(): string
    {
        $type = $this->audit_type === 'statutory' ? 'Statutory' : 'Internal';
        $period = $this->period === 'FY' ? $this->fy_label : "{$this->fy_label} {$this->period}";

        return "$period · $type audit";
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class)->withTrashed();
    }

    public function processes(): HasMany
    {
        return $this->hasMany(EngagementProcess::class)->orderBy('id');
    }

    public function tests(): HasMany
    {
        return $this->hasMany(ControlTest::class);
    }
}
