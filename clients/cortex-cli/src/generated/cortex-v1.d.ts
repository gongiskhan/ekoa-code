/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: docs/openapi/cortex.v1.json (the public Cortex Capability API contract).
 * Regenerate: npm run generate --workspace @ekoa/cortex-cli
 * Verify:     npm run gate:client-drift (root)
 */
export interface paths {
    "/api/v1/automations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/automations */
        get: operations["automations.list"];
        put?: never;
        /** POST /api/v1/automations */
        post: operations["automations.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/automations/{id} */
        get: operations["automations.get"];
        put?: never;
        post?: never;
        /** DELETE /api/v1/automations/{id} */
        delete: operations["automations.remove"];
        options?: never;
        head?: never;
        /** PATCH /api/v1/automations/{id} */
        patch: operations["automations.patch"];
        trace?: never;
    };
    "/api/v1/automations/{id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/automations/{id}/runs */
        post: operations["automations.createRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/approved-commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/automations/approved-commands */
        get: operations["automations.approvedCommands"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/approved-commands/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/automations/approved-commands/revoke */
        post: operations["automations.revokeApprovedCommand"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/automations/catalog */
        get: operations["automations.catalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/automations/plan */
        post: operations["automations.plan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/automations/runs */
        get: operations["automations.listRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/automations/runs/{id} */
        get: operations["automations.getRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/runs/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/automations/runs/{id}/cancel */
        post: operations["automations.cancelRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/runs/{id}/consent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/automations/runs/{id}/consent */
        post: operations["automations.consent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/runs/{id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/automations/runs/{id}/logs */
        get: operations["automations.getRunLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/runs/{id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/automations/runs/{id}/resume */
        post: operations["automations.resumeRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/runs/{id}/steps/{stepId}/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/automations/runs/{id}/steps/{stepId}/feedback */
        post: operations["automations.stepFeedback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/integrations */
        get: operations["integrations.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/integrations/{key} */
        get: operations["integrations.getIntegration"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/{key}/actions/{actionName}/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/integrations/{key}/actions/{actionName}/execute */
        post: operations["integrations.executeAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/knowledge/collections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/knowledge/collections */
        get: operations["knowledge.listCollections"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/knowledge/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/knowledge/documents */
        get: operations["knowledge.listDocuments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/knowledge/documents/{collection}/{docId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/knowledge/documents/{collection}/{docId} */
        get: operations["knowledge.readKnowledgeDoc"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/knowledge/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/knowledge/search */
        post: operations["knowledge.searchKnowledge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memvault/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/memvault/export */
        get: operations["memvault.exportVault"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memvault/note": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/memvault/note */
        get: operations["memvault.readNote"];
        put?: never;
        post?: never;
        /** DELETE /api/v1/memvault/note */
        delete: operations["memvault.deleteNote"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memvault/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** GET /api/v1/memvault/notes */
        get: operations["memvault.listNotes"];
        put?: never;
        /** POST /api/v1/memvault/notes */
        post: operations["memvault.writeNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memvault/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** POST /api/v1/memvault/search */
        post: operations["memvault.searchNotes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ApprovedCommand: {
            createdAt?: components["schemas"]["IsoTimestamp"];
            description?: string;
            shape: string;
        } & {
            [key: string]: unknown;
        };
        ApprovedCommandListResponse: {
            items: components["schemas"]["ApprovedCommand"][];
        };
        Automation: {
            createdAt?: components["schemas"]["IsoTimestamp"];
            description?: string;
            id: components["schemas"]["Id"];
            name: string;
            orgId?: components["schemas"]["Id"];
            ownerId?: components["schemas"]["Id"];
            plan?: components["schemas"]["Plan"];
            status?: string;
            updatedAt?: components["schemas"]["IsoTimestamp"];
            visibility?: components["schemas"]["Visibility"];
        } & {
            [key: string]: unknown;
        };
        AutomationCreateRequest: {
            description?: string;
            name: string;
            plan?: components["schemas"]["Plan"];
            visibility?: components["schemas"]["Visibility"];
        } & {
            [key: string]: unknown;
        };
        AutomationListResponse: {
            items: components["schemas"]["Automation"][];
        };
        AutomationPatch: {
            description?: string;
            name?: string;
            plan?: components["schemas"]["Plan"];
            status?: string;
            visibility?: components["schemas"]["Visibility"];
        } & {
            [key: string]: unknown;
        };
        CatalogEntry: {
            description?: string;
            key: string;
            name: string;
            type?: string;
        } & {
            [key: string]: unknown;
        };
        CatalogResponse: {
            automations: components["schemas"]["CatalogEntry"][];
            integrationActions: components["schemas"]["CatalogEntry"][];
        };
        CollectionsResponse: {
            items: string[];
        };
        ConsentRequest: {
            /** @enum {string} */
            decision: "once" | "always" | "stop";
            shape: string;
        };
        ConsentResult: {
            /** @enum {string} */
            decision?: "once" | "always" | "stop";
            persisted?: boolean;
            resumed?: boolean;
        } & {
            [key: string]: unknown;
        };
        DeleteNoteResponse: {
            /** @constant */
            ok: true;
        };
        DocumentsResponse: {
            items: components["schemas"]["KnowledgeDocSummary"][];
            total: number;
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_FAILED" | "UNAUTHENTICATED" | "TOKEN_EXPIRED" | "BILLING_BLOCKED" | "BILLING_LOCKED" | "FORBIDDEN" | "ACCOUNT_DISABLED" | "NOT_FOUND" | "DAEMON_NOT_CONNECTED" | "DUPLICATE_BUILD" | "SLUG_TAKEN" | "MANIFEST_ID_MISMATCH" | "TRIGGER_DISABLED" | "PAYLOAD_TOO_LARGE" | "SECRET_GUARD_BLOCKED" | "RATE_LIMITED" | "INTERNAL" | "UPSTREAM_FAILED" | "UPSTREAM_UNAVAILABLE";
        ErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"];
                details?: {
                    [key: string]: components["schemas"]["JsonValue"];
                };
                message: string;
            };
        };
        ExecuteIntegrationActionRequest: {
            args?: {
                [key: string]: unknown;
            };
        };
        ExecuteIntegrationActionResponse: {
            code?: string;
            data?: unknown;
            error?: string;
            status?: number;
            success: boolean;
        };
        Id: string;
        IdempotencyKey: string;
        IntegrationCapability: {
            actions: components["schemas"]["IntegrationCapabilityAction"][];
            connected: boolean;
            integration: components["schemas"]["IntegrationDefinition"];
        };
        IntegrationCapabilityAction: {
            actionName: string;
            approved: boolean;
            backingType: string;
            description: string;
            requiresApproval: boolean;
            shape: string;
            target: string;
            transport: string;
        };
        IntegrationDefinition: {
            actions?: {
                [key: string]: unknown;
            }[];
            authType?: string;
            createdAt?: components["schemas"]["IsoTimestamp"];
            description?: string;
            displayName?: string;
            icon?: string;
            key: string;
            updatedAt?: components["schemas"]["IsoTimestamp"];
            userCreated?: boolean;
            version?: string;
        } & {
            [key: string]: unknown;
        };
        IntegrationDefinitionListResponse: {
            items: components["schemas"]["IntegrationDefinition"][];
        };
        /** Format: date-time */
        IsoTimestamp: string;
        JsonValue: string | number | boolean | null | components["schemas"]["JsonValue"][] | {
            [key: string]: components["schemas"]["JsonValue"];
        };
        KnowledgeDocSummary: {
            chunks?: number;
            collection: string;
            createdAt?: components["schemas"]["IsoTimestamp"];
            id: components["schemas"]["Id"];
            language?: string;
            size?: number;
            sourceType?: string;
            sourceUrl?: string;
            title: string;
            updatedAt?: components["schemas"]["IsoTimestamp"];
        } & {
            [key: string]: unknown;
        };
        KnowledgeDocumentResponse: {
            chunks?: number;
            collection: string;
            contentMd: string;
            createdAt?: components["schemas"]["IsoTimestamp"];
            createdAtRaw?: string;
            id: components["schemas"]["Id"];
            language?: string;
            /** @enum {string} */
            scope: "org" | "shared";
            size?: number;
            sourceType?: string;
            sourceUrl?: string;
            title: string;
            updatedAt?: components["schemas"]["IsoTimestamp"];
        } & {
            [key: string]: unknown;
        };
        KnowledgeSearchHit: {
            collection: string;
            docId: string;
            /** @enum {string} */
            scope: "org" | "shared";
            score?: number;
            snippet?: string;
            sourceUrl?: string;
            title?: string;
        };
        KnowledgeSearchRequest: {
            collection?: components["schemas"]["KnowledgeSegment"];
            limit?: number;
            query: string;
        };
        KnowledgeSearchResponse: {
            hits: components["schemas"]["KnowledgeSearchHit"][];
        };
        KnowledgeSegment: string;
        /**
         * @default pt
         * @enum {string}
         */
        Language: "pt" | "en";
        NoteFolder: string;
        NoteListItem: {
            created: components["schemas"]["IsoTimestamp"];
            folder?: components["schemas"]["NoteFolder"];
            modified: components["schemas"]["IsoTimestamp"];
            permalink: components["schemas"]["NoteFolder"];
            tags: string[];
            title: string;
            type: string;
        };
        NoteListResponse: {
            items: components["schemas"]["NoteListItem"][];
            nextCursor?: string;
        };
        NoteRecord: {
            contentMd: string;
            created: components["schemas"]["IsoTimestamp"];
            folder?: components["schemas"]["NoteFolder"];
            modified: components["schemas"]["IsoTimestamp"];
            permalink: components["schemas"]["NoteFolder"];
            tags: string[];
            title: string;
            type: string;
        };
        NoteSearchHit: {
            permalink: components["schemas"]["NoteFolder"];
            score?: number;
            snippet?: string;
            title: string;
        };
        NoteSearchRequest: {
            limit?: number;
            query: string;
        };
        NoteSearchResponse: {
            hits: components["schemas"]["NoteSearchHit"][];
        };
        OkResponse: {
            /** @constant */
            ok: true;
        };
        Plan: {
            reason?: string;
            status?: string;
            steps?: components["schemas"]["PlanStep"][];
        } & {
            [key: string]: unknown;
        };
        PlanRequest: {
            automationId?: components["schemas"]["Id"];
            goal: string;
            language?: components["schemas"]["Language"];
            name?: string;
        };
        PlanResponse: {
            automation?: components["schemas"]["Automation"];
            plan: components["schemas"]["Plan"];
            rehearsing?: boolean;
            runId?: components["schemas"]["Id"];
        };
        PlanStep: {
            argv?: string[];
            description?: string;
            index?: number;
            stepId?: components["schemas"]["Id"];
            tool?: string;
        } & {
            [key: string]: unknown;
        };
        RevokeApprovedCommandRequest: {
            shape: string;
        };
        RevokeApprovedCommandResponse: {
            remaining: number;
            revoked: boolean;
        };
        RunCancelResponse: {
            cancelled: boolean;
        };
        RunCreateRequest: {
            idempotencyKey?: components["schemas"]["IdempotencyKey"];
            inputs?: {
                [key: string]: unknown;
            };
        };
        RunCreateResponse: {
            runId: components["schemas"]["Id"];
        };
        RunListResponse: {
            items: components["schemas"]["RunRecord"][];
        };
        RunLogsResponse: {
            runId: components["schemas"]["Id"];
            steps: components["schemas"]["RunLogStep"][];
        };
        RunLogStep: {
            log: string;
            stepIndex: number;
            truncated: boolean;
        };
        RunRecord: {
            automationId: components["schemas"]["Id"];
            finishedAt?: components["schemas"]["IsoTimestamp"];
            id: components["schemas"]["Id"];
            inputs?: {
                [key: string]: unknown;
            };
            orgId?: components["schemas"]["Id"];
            ownerId?: components["schemas"]["Id"];
            startedAt?: components["schemas"]["IsoTimestamp"];
            status: components["schemas"]["RunStatus"];
            steps?: components["schemas"]["RunStepRecord"][];
            summary?: string;
        } & {
            [key: string]: unknown;
        };
        RunResumeResponse: {
            resumed: boolean;
        };
        /** @enum {string} */
        RunStatus: "idle" | "running" | "completed" | "failed" | "cancelled" | "awaiting_integration" | "paused_for_user" | "awaiting_consent" | "awaiting_daemon";
        RunStepRecord: {
            durationMs?: number;
            error?: {
                message: string;
                recoverable?: boolean;
            } & {
                [key: string]: unknown;
            };
            index?: number;
            screenshotUrl?: string;
            status?: string;
            stepId?: string;
            tier?: string;
        } & {
            [key: string]: unknown;
        };
        StepFeedbackRequest: {
            kind: string;
            note?: string;
        };
        StepFeedbackResponse: {
            evicted?: boolean;
            /** @constant */
            ok: true;
        };
        /** @enum {string} */
        Visibility: "private" | "org";
        WriteNoteRequest: {
            contentMd: string;
            folder?: components["schemas"]["NoteFolder"];
            permalink?: components["schemas"]["NoteFolder"];
            tags?: string[];
            title: string;
            type?: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    "automations.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationListResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationCreateRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Automation"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Automation"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.patch": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationPatch"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Automation"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.createRun": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RunCreateRequest"];
            };
        };
        responses: {
            /** @description Success. This operation answers one of 202 or 200; the STATUS CODE is the discriminator - the response body schema is identical for each. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunCreateResponse"];
                };
            };
            /** @description Accepted - processing started. This operation answers one of 202 or 200; the STATUS CODE is the discriminator - the response body schema is identical for each. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunCreateResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.approvedCommands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovedCommandListResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.revokeApprovedCommand": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevokeApprovedCommandRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevokeApprovedCommandResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.listRuns": {
        parameters: {
            query?: {
                automationId?: components["schemas"]["Id"];
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunListResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.getRun": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunRecord"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.cancelRun": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunCancelResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.consent": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsentRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsentResult"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.getRunLogs": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunLogsResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.resumeRun": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunResumeResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "automations.stepFeedback": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                stepId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepFeedbackRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepFeedbackResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "integrations.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationDefinitionListResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "integrations.getIntegration": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationCapability"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "integrations.executeAction": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                actionName: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExecuteIntegrationActionRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecuteIntegrationActionResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "knowledge.listCollections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CollectionsResponse"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "knowledge.listDocuments": {
        parameters: {
            query?: {
                collection?: string;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentsResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "knowledge.readKnowledgeDoc": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                collection: components["schemas"]["KnowledgeSegment"];
                docId: components["schemas"]["KnowledgeSegment"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeDocumentResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "knowledge.searchKnowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeSearchRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeSearchResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "memvault.exportVault": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opaque bytes (`application/x-tar`). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/x-tar": string;
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "memvault.readNote": {
        parameters: {
            query: {
                permalink: components["schemas"]["NoteFolder"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteRecord"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "memvault.deleteNote": {
        parameters: {
            query: {
                permalink: components["schemas"]["NoteFolder"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteNoteResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "memvault.listNotes": {
        parameters: {
            query?: {
                cursor?: string;
                folder?: components["schemas"]["NoteFolder"];
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteListResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "memvault.writeNote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WriteNoteRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteRecord"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    "memvault.searchNotes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NoteSearchRequest"];
            };
        };
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteSearchResponse"];
                };
            };
            /** @description Request body, query string or path segment failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`). */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Request body exceeded the platform JSON body limit of 1 MiB (`PAYLOAD_TOO_LARGE`). Note this is a BYTE limit, while schema `maxLength` counts CHARACTERS: a body inside its declared `maxLength` can still exceed it. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Rate limited by the per-key capability window (`RATE_LIMITED`). */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Internal error (`INTERNAL`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
}
