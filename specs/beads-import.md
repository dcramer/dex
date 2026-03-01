# Beads Import (MVP)

Add `dex import --beads <path> [issue-id...]` to ingest Beads JSONL exports into Dex tasks.

## Goals

- Import Beads issue graphs without adding a full sync integration.
- Preserve Beads provenance in task metadata.
- Keep imports idempotent and safe to re-run.
- Keep existing GitHub/Shortcut import flows unchanged.

## CLI Contract

- New flag: `--beads <path>`
- Supported with:
  - `--dry-run`
  - `--update`
- Optional positional arguments in Beads mode:
  - `[issue-id...]` to import one or more root Beads issues and all descendants
- Invalid combinations:
  - `--beads` with `--all`, `--github`, or `--shortcut`

## Data Mapping

- `id` -> task `id`
- `title` -> task `name`
- `description` -> task `description`
- `priority` -> task `priority`
- `status=closed` (or `closed_at` present) -> `completed=true`
- `created_at`, `updated_at`, `closed_at` -> task timestamps
- `status in {in_progress, hooked}` -> `started_at` (best-effort from `updated_at`)
- Dependency type `parent-child` -> task `parent_id`
- Dependency type `blocks` -> task `blockedBy`
- Non-blocking dependency types are preserved in `metadata.beads` and not mapped to Dex relationships.

## Implementation Shape

- Add Beads parser/normalizer under `src/core/beads/`.
- Extend task metadata schema with `metadata.beads` in `src/types.ts`.
- Extend `src/cli/import.ts` to handle `--beads` branch.
- Apply import in two passes:
  1. Upsert task fields (create/update)
  2. Apply relationships (parent + blockers)

Relationship failures (depth/cycle/missing target) should produce warnings and continue.

## Test Strategy

- Parser tests in `src/core/beads/import.test.ts`:
  - valid JSONL parsing
  - dependency normalization
  - malformed line handling (line number in error)
- CLI tests in `src/cli/import.test.ts`:
  - happy path import
  - dry-run no writes
  - update semantics
  - invalid flag combinations
  - relationship warnings do not abort import
- Schema test in `src/types.test.ts` for `metadata.beads` compatibility.

## Anonymized Fixtures

- Add anonymized Beads-derived fixtures under `src/core/beads/fixtures/`.
- Produce fixture data from local Beads exports via an external/local workflow that:
  - pseudonymizes IDs/actors/labels/external refs
  - redacts free-text fields
  - preserves graph shape, status mix, priorities, and dependency semantics

No raw Beads state or secret-bearing exports are committed.
