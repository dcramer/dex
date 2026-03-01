import type { BeadsMetadata } from "../../types.js";

export interface ParsedBeadsIssue {
  id: string;
  name: string;
  description: string;
  priority: number;
  completed: boolean;
  result: string | null;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  parentId?: string;
  blockerIds: string[];
  beadsMetadata: BeadsMetadata;
}

export interface ParsedBeadsImport {
  issues: ParsedBeadsIssue[];
  warnings: string[];
}

interface NormalizedDependency {
  issueId: string;
  dependsOnId: string;
  type: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return items.length > 0 ? items : undefined;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeStatus(status: string | undefined): string | undefined {
  if (!status) return undefined;
  return status.trim().toLowerCase();
}

function extractEmbeddedIssue(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const embedded = record.Issue;
  const embeddedRecord = asRecord(embedded);
  if (!embeddedRecord) return record;

  // Prefer embedded issue fields but allow top-level fallback.
  return {
    ...record,
    ...embeddedRecord,
  };
}

function parseDependency(
  raw: unknown,
  fallbackIssueId: string,
): NormalizedDependency | null {
  const record = asRecord(raw);
  if (!record) return null;

  const type =
    getString(record, "type") ?? getString(record, "dependency_type");
  if (!type) return null;

  const issueId = getString(record, "issue_id") ?? fallbackIssueId;

  const dependsOnRecord = asRecord(record.depends_on);
  const dependsOnId =
    getString(record, "depends_on_id") ??
    (dependsOnRecord ? getString(dependsOnRecord, "id") : undefined) ??
    getString(record, "id");

  if (!issueId || !dependsOnId) return null;

  return {
    issueId,
    dependsOnId,
    type,
  };
}

function parseIssueRecord(
  lineNo: number,
  line: string,
): { issue: ParsedBeadsIssue | null; warnings: string[] } {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON on line ${lineNo}: ${message}`);
  }

  const root = asRecord(parsed);
  if (!root) {
    warnings.push(`Line ${lineNo}: expected JSON object, skipping`);
    return { issue: null, warnings };
  }

  const record = extractEmbeddedIssue(root);

  const id = getString(record, "id");
  const title = getString(record, "title");
  if (!id || !title) {
    warnings.push(`Line ${lineNo}: missing required id/title, skipping`);
    return { issue: null, warnings };
  }

  const description = getString(record, "description") ?? "";
  const status = normalizeStatus(getString(record, "status"));
  const priority = Math.max(
    0,
    Math.min(100, Math.trunc(getNumber(record, "priority") ?? 1)),
  );

  const createdAt = getString(record, "created_at");
  const updatedAt = getString(record, "updated_at");
  const closedAt = getString(record, "closed_at");

  const completed = status === "closed" || Boolean(closedAt);
  const closeReason = getString(record, "close_reason");
  const result = completed
    ? (closeReason ?? "Imported as completed from Beads")
    : null;

  const startedAt =
    status === "in_progress" || status === "hooked"
      ? (updatedAt ?? createdAt ?? null)
      : null;

  const depsRaw = Array.isArray(record.dependencies) ? record.dependencies : [];
  const normalizedDeps = depsRaw
    .map((dep) => parseDependency(dep, id))
    .filter((dep): dep is NormalizedDependency => dep !== null);

  const parentCandidates = dedupe(
    normalizedDeps
      .filter((dep) => dep.type === "parent-child")
      .map((dep) => dep.dependsOnId),
  );
  if (parentCandidates.length > 1) {
    warnings.push(
      `Issue ${id}: multiple parent-child dependencies found (${parentCandidates.join(", ")}), using ${parentCandidates[0]}`,
    );
  }

  const blockerIds = dedupe(
    normalizedDeps
      .filter((dep) => dep.type === "blocks")
      .map((dep) => dep.dependsOnId),
  );

  const labels = getStringArray(record, "labels");
  const dependencyTypes = dedupe(normalizedDeps.map((dep) => dep.type));

  const beadsMetadata: BeadsMetadata = {
    issueId: id,
    ...(status && { status }),
    ...(getString(record, "issue_type") && {
      issueType: getString(record, "issue_type"),
    }),
    ...(getString(record, "source_system") && {
      sourceSystem: getString(record, "source_system"),
    }),
    ...(getString(record, "external_ref") && {
      externalRef: getString(record, "external_ref"),
    }),
    ...(labels && { labels }),
    ...(parentCandidates[0] && { parentId: parentCandidates[0] }),
    ...(blockerIds.length > 0 && { blockerIds }),
    ...(dependencyTypes.length > 0 && { dependencyTypes }),
  };

  return {
    issue: {
      id,
      name: title,
      description,
      priority,
      completed,
      result,
      created_at: createdAt,
      updated_at: updatedAt,
      started_at: startedAt,
      completed_at: closedAt ?? null,
      parentId: parentCandidates[0],
      blockerIds,
      beadsMetadata,
    },
    warnings,
  };
}

export function parseBeadsExportJsonl(input: string): ParsedBeadsImport {
  const warnings: string[] = [];
  const issues: ParsedBeadsIssue[] = [];
  const seen = new Set<string>();

  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (!line) continue;

    const { issue, warnings: lineWarnings } = parseIssueRecord(lineNo, line);
    warnings.push(...lineWarnings);
    if (!issue) continue;

    if (seen.has(issue.id)) {
      throw new Error(`Duplicate issue id in input: ${issue.id}`);
    }
    seen.add(issue.id);
    issues.push(issue);
  }

  return { issues, warnings };
}
