<?php

namespace App\Http\Controllers\Api\Audit;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Services\AuditLogger;
use App\Services\AuditWorkflow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ClientController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $mine = AuditWorkflow::restrictedTo($request);
        $clients = Client::query()
            ->withCount('engagements')
            ->when($mine, fn ($q) => $q->whereHas('engagements.processes', fn ($w) => $w->where('assigned_to', $mine)))
            ->when($request->query('search'), fn ($q, $s) => $q->where(fn ($w) => $w->where('name', 'like', "%$s%")->orWhere('code', 'like', "%$s%")))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $clients]);
    }

    public function store(Request $request): JsonResponse
    {
        $client = Client::create($this->validated($request) + ['created_by' => $request->user()->id]);
        AuditLogger::record('client.created', $client, null, $client->only(['name', 'code', 'status']));

        return response()->json(['data' => $client], 201);
    }

    public function update(Request $request, Client $client): JsonResponse
    {
        $data = $this->validated($request, $client);
        $before = $client->only(array_keys($data));
        $client->update($data);
        [$b, $a] = AuditLogger::diff($before, $client->only(array_keys($before)));
        AuditLogger::record('client.updated', $client, $b, $a);

        return response()->json(['data' => $client]);
    }

    public function destroy(Client $client): JsonResponse
    {
        if ($client->engagements()->exists()) {
            return response()->json(['message' => 'This client has engagements. Mark it inactive instead of deleting it.'], 422);
        }
        $client->delete();
        AuditLogger::record('client.deleted', $client, $client->only(['name', 'code']));

        return response()->json(['success' => true]);
    }

    private function validated(Request $request, ?Client $client = null): array
    {
        $tenantId = $request->attributes->get('tenant')->id;

        return $request->validate([
            'name' => ['required', 'string', 'max:190', Rule::unique('clients')->where('tenant_id', $tenantId)->whereNull('deleted_at')->ignore($client?->id)],
            'code' => ['nullable', 'string', 'max:30'],
            'industry' => ['nullable', 'string', 'max:100'],
            'contact_name' => ['nullable', 'string', 'max:120'],
            'contact_email' => ['nullable', 'email', 'max:190'],
            'contact_phone' => ['nullable', 'string', 'max:40'],
            'address' => ['nullable', 'string', 'max:1000'],
            'status' => ['required', Rule::in(['active', 'inactive'])],
        ]);
    }
}
