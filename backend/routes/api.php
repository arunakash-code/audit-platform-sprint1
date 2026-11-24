<?php

use App\Http\Controllers\Api\Admin\AuditLogController;
use App\Http\Controllers\Api\Admin\DashboardController;
use App\Http\Controllers\Api\Admin\LeadController;
use App\Http\Controllers\Api\Admin\PageController;
use App\Http\Controllers\Api\Admin\SettingsController;
use App\Http\Controllers\Api\Admin\UniversityController;
use App\Http\Controllers\Api\Admin\UserController;
use App\Http\Controllers\Api\Audit\ClientController;
use App\Http\Controllers\Api\Audit\DashboardController as AuditDashboardController;
use App\Http\Controllers\Api\Audit\EngagementController;
use App\Http\Controllers\Api\Audit\LibraryController;
use App\Http\Controllers\Api\Audit\MetaController as AuditMetaController;
use App\Http\Controllers\Api\Audit\QueryController;
use App\Http\Controllers\Api\Audit\TestingController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\Public\SiteController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/health', fn () => response()->json([
        'success' => true,
        'service' => 'audit-platform-api',
        'version' => 'v1',
    ]));

    Route::middleware('tenant')->group(function () {
        // ---- Public website -------------------------------------------------
        Route::get('/site', [SiteController::class, 'settings']);
        Route::get('/pages/{slug}', [SiteController::class, 'page']);
        Route::get('/university', [SiteController::class, 'university']);
        Route::get('/university/{slug}', [SiteController::class, 'universityResource']);
        Route::post('/leads', [SiteController::class, 'storeLead'])->middleware('throttle:5,1');

        // ---- Auth ------------------------------------------------------------
        Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:6,1');

        Route::middleware(['auth:sanctum', 'tenant.member'])->group(function () {
            Route::post('/auth/logout', [AuthController::class, 'logout']);
            Route::get('/auth/me', [AuthController::class, 'me']);

            // ---- Admin panel -------------------------------------------------
            Route::prefix('admin')->group(function () {
                Route::get('/dashboard', DashboardController::class);

                Route::middleware('permission:cms.pages.manage')->group(function () {
                    Route::apiResource('pages', PageController::class);
                    Route::post('pages/{page}/versions/{version}/restore', [PageController::class, 'restoreVersion']);
                });

                Route::middleware('permission:cms.university.manage')->group(function () {
                    Route::apiResource('university', UniversityController::class)->parameters(['university' => 'resource']);
                });

                Route::middleware('permission:cms.leads.manage')->group(function () {
                    Route::get('leads/export', [LeadController::class, 'export']);
                    Route::apiResource('leads', LeadController::class)->only(['index', 'update', 'destroy']);
                });

                Route::middleware('permission:cms.settings.manage')->group(function () {
                    Route::get('settings', [SettingsController::class, 'show']);
                    Route::put('settings', [SettingsController::class, 'update']);
                });

                Route::middleware('permission:users.manage')->group(function () {
                    Route::apiResource('users', UserController::class)->only(['index', 'store', 'update']);
                });

                Route::get('audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit_logs.view');
            });

            // ---- Audit workspace ---------------------------------------------
            Route::prefix('audit')->group(function () {
                Route::middleware('permission:audit.view|audit.test|audit.manage')->group(function () {
                    Route::get('meta', AuditMetaController::class);
                    Route::get('dashboard', AuditDashboardController::class);
                    Route::get('my-work', [TestingController::class, 'myWork']);
                    Route::get('engagements', [EngagementController::class, 'index']);
                    Route::get('engagements/{engagement}', [EngagementController::class, 'show']);
                    Route::get('engagement-processes/{engagementProcess}', [TestingController::class, 'showProcess']);
                    Route::get('queries', [QueryController::class, 'index']);
                    Route::get('library', [LibraryController::class, 'index']);
                    Route::get('clients', [ClientController::class, 'index']);
                });

                // Recording results: controller checks the user is the assignee or a manager.
                Route::middleware('permission:audit.test|audit.manage')->group(function () {
                    Route::put('control-tests/{controlTest}', [TestingController::class, 'update']);
                    Route::post('control-tests/{controlTest}/retest', [TestingController::class, 'retest']);
                });

                Route::middleware('permission:audit.manage')->group(function () {
                    Route::apiResource('clients', ClientController::class)->only(['store', 'update', 'destroy']);

                    Route::post('engagements', [EngagementController::class, 'store']);
                    Route::put('engagements/{engagement}', [EngagementController::class, 'update']);
                    Route::delete('engagements/{engagement}', [EngagementController::class, 'destroy']);
                    Route::post('engagements/{engagement}/processes', [EngagementController::class, 'addProcesses']);
                    Route::put('engagement-processes/{engagementProcess}', [EngagementController::class, 'updateProcess']);
                    Route::delete('engagement-processes/{engagementProcess}', [EngagementController::class, 'removeProcess']);
                    Route::get('engagements/{engagement}/report', [EngagementController::class, 'report']);
                    Route::put('engagements/{engagement}/report-details', [EngagementController::class, 'updateReportDetails']);

                    Route::post('library/processes', [LibraryController::class, 'storeProcess']);
                    Route::put('library/processes/{process}', [LibraryController::class, 'updateProcess']);
                    Route::delete('library/processes/{process}', [LibraryController::class, 'destroyProcess']);
                    Route::post('library/processes/{process}/risks', [LibraryController::class, 'storeRisk']);
                    Route::put('library/risks/{risk}', [LibraryController::class, 'updateRisk']);
                    Route::delete('library/risks/{risk}', [LibraryController::class, 'destroyRisk']);
                    Route::post('library/risks/{risk}/controls', [LibraryController::class, 'storeControl']);
                    Route::put('library/controls/{control}', [LibraryController::class, 'updateControl']);
                    Route::delete('library/controls/{control}', [LibraryController::class, 'destroyControl']);
                });
            });
        });
    });
});
