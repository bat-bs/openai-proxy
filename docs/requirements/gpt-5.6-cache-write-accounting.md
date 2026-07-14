# GPT-5.6 Cache-Write Accounting

## User story

As an operator of `openai-proxy`, I want GPT-5.6-family requests to record and price the
provider-reported cache-write token count, so internal reporting reflects the usage that the
provider exposes directly.

This feature records provider usage. It must not infer, backfill, or describe reconstructed
values as billing data.

## Provider facts

OpenAI documents cache-write pricing for GPT-5.6 and later model families. It also documents:

- Responses API: `usage.input_tokens_details.cache_write_tokens`
- Chat Completions API: `usage.prompt_tokens_details.cache_write_tokens`

`cache_write_tokens` is the number of input tokens written to the cache. `cached_tokens` is a
separate read count. Cache writes must therefore be stored and priced as a fourth token
dimension; they must not be derived from cached reads.

Official references, checked 2026-07-14:

- [API pricing](https://developers.openai.com/api/docs/pricing)
- [Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Responses object reference](https://developers.openai.com/api/docs/api-reference/responses/object)

## Scope

Implement these areas only:

1. The existing Go response parsing and request write path.
2. The existing Next.js schema, pricing, reporting, and usage surfaces.
3. Tests for extraction, persistence, pricing resolution, and aggregation.

Do not add provider-specific inference. If a compatible upstream response omits
`cache_write_tokens`, record zero and leave the value visibly absent from the accounting; do not
guess it from a later request.

## Non-goals

- No cache-write estimation or confidence levels.
- No prompt-cache body metadata parsing.
- No `session-id`/`thread-id` lineage tracking.
- No predecessor lookup, transactional backfill, or background worker.
- No explicit breakpoint accounting beyond recording the provider's reported field.
- No historical backfill.
- No new cache-write table.
- No legacy Go UI/reporting changes unless required by an existing shared schema contract.
- No pricing seed row; administrators may add `cache_write` pricing manually.

## Canonical names

| Layer | Name |
| --- | --- |
| DB column | `cache_write_token_count` |
| Go field | `CacheWriteTokenCount` |
| Drizzle field | `cacheWriteTokenCount` |
| Router aggregate field | `cacheWriteTokens` |
| Cost token type | `cache_write` |
| Cost breakdown field | `cacheWriteCost` |

The removed estimation names must not be reintroduced:
`cache_write_estimated_token_count`, `cache_write_estimation_confidence`, and
`cache_write_estimated_from_request_id`.

## Database changes

Add this column to `requests`:

```sql
cache_write_token_count integer NOT NULL DEFAULT 0
```

Update the current WIP migration and `db/schema.sql` so fresh and migrated databases have the
same post-migration shape. Remove the un-applied estimation columns and lineage index from the
WIP migration. Do not add cache metadata columns.

If the WIP migration has already been applied outside this worktree, do not edit its history;
create a corrective migration instead. In the normal un-applied WIP state, replace it and
regenerate `db/migrations/atlas.sum`.

## Go request and response handling

Extend `db.Request` with `CacheWriteTokenCount int`. `db.Database.WriteRequest` must insert that
field in the same request row as the existing input, cached-input, and output fields. It must be
a single ordinary insert; no transaction or predecessor query is needed for cache writes.

Extend usage extraction to return both cached reads and cache writes. Look for:

1. `input_tokens_details.cache_write_tokens` for Responses usage.
2. `prompt_tokens_details.cache_write_tokens` for Chat Completions usage.
3. Nested usage objects already supported by the response parser.

The normal JSON path, completed SSE path, and SSE fallback path must all use the same direct
field mapping. A missing or malformed field becomes zero. Clamp negative values to zero. Do not
set `IsApproximated` merely because the provider omitted the optional cache-write field; that
flag retains its existing meaning for other approximations such as estimated streaming output.

Cache-write tokens are independent of `InputTokenCount` and `CachedInputTokenCount`:

- `InputTokenCount`: provider input token count.
- `CachedInputTokenCount`: provider cached-read count.
- `CacheWriteTokenCount`: provider cache-write count.
- `OutputTokenCount`: provider output count.

For billing, ordinary uncached input is the non-overlapping remainder:
`max(0, InputTokenCount - CachedInputTokenCount - CacheWriteTokenCount)`. Cache-write tokens
are priced separately and must not also be included in ordinary input pricing.

## App pricing and aggregation

Treat `cache_write` as a first-class cost type alongside `input`, `cached`, and `output`.

The resolver must:

- resolve cache-write pricing using the request's model, request time, and input context stage;
- mark a request missing-cost when positive cache-write tokens have no matching price;
- keep missing-cost false when cache-write tokens are zero and no cache-write price exists;
- include cache-write cost in totals and breakdowns.

Routers must expose `cacheWriteTokens` and per-model `cacheWriteCost`. Existing total-token
semantics remain unchanged: cache-write tokens are an additional metric, not added to implicit
input/output totals.

## UI behavior

Show cache-write tokens wherever input, cached-input, and output usage are shown. Use authoritative
labels such as `Cache-Write-Tokens`; do not use “estimated” labels or explanatory notes.

The admin pricing UI must allow the `cache_write` token type using the shared token-type options.

## Required tests

- Extract `cache_write_tokens` from Responses `input_tokens_details`.
- Extract it from Chat Completions `prompt_tokens_details`.
- Extract it from nested and SSE usage paths.
- Preserve zero when the field is absent or malformed.
- Persist the direct count in `WriteRequest`.
- Resolve and aggregate cache-write pricing.
- Keep zero-token requests resolvable without a cache-write price.
- Make positive-token requests missing-cost when the cache-write price is absent.
- Verify UI/router data shapes use authoritative names and do not contain estimation wording.

## Required files

Production changes should be limited to the existing response, database, migration, app schema,
pricing, router, UI, and release-note files already used by the repository. Do not add estimator,
lineage, or request-metadata helper files.
