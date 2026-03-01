# Beads Fixtures

These fixtures are anonymized and derived from real local Beads state under `~/Development`.

## Files

- `basic.jsonl` - small representative sample for smoke tests
- `graph.jsonl` - includes parent-child and blocks relationships
- `edge-cases.jsonl` - includes non-ideal relationships (e.g. missing targets)

## Regeneration

Fixtures are intentionally committed as static anonymized snapshots.

When refreshing them, use a local one-off script/workflow outside this repository,
then copy in only anonymized output.

Raw Beads data is never written into this repository.
