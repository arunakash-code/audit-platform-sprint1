<?php

use App\Http\Middleware\EnsureTenantMember;
use App\Http\Middleware\RequirePermission;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Routing\Middleware\SubstituteBindings;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Sanctum SPA cookie auth for first-party frontends listed in SANCTUM_STATEFUL_DOMAINS.
        $middleware->statefulApi();

        // Behind Render's load balancer (and the Netlify proxy): trust X-Forwarded-* so
        // Laravel sees HTTPS and secure session cookies are issued correctly.
        $middleware->trustProxies(at: '*');

        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'tenant.member' => EnsureTenantMember::class,
            'permission' => RequirePermission::class,
        ]);

        // The tenant must be resolved before route-model binding so the
        // BelongsToTenant global scope applies to bound models ({page}, {lead}...).
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveTenant::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
