<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fields needed by the Internal Audit Report template:
 *  - per observation: recommendation and management's agreement (agreed / partially agreed / not agreed)
 *  - per engagement: report details (reference no., scope, limitations, fieldwork dates, reviewer, distribution…)
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('control_tests', function (Blueprint $t) {
            $t->text('recommendation')->nullable()->after('management_response');
            $t->string('management_agreement', 20)->nullable()->after('recommendation');
        });

        Schema::table('engagements', function (Blueprint $t) {
            $t->json('report_details')->nullable()->after('notes');
        });
    }

    public function down(): void
    {
        Schema::table('control_tests', function (Blueprint $t) {
            $t->dropColumn(['recommendation', 'management_agreement']);
        });
        Schema::table('engagements', function (Blueprint $t) {
            $t->dropColumn('report_details');
        });
    }
};
