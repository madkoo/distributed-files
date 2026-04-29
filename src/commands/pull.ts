import { ensureCached } from '../cache';
import { requireManifest } from '../config';
import { syncEntry } from '../sync';
import type { ManifestEntry, PullResult } from '../types';

interface PullOptions {
  dryRun?: boolean;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectEntries(entries: ManifestEntry[], ids: string[]): ManifestEntry[] {
  if (ids.length === 0) {
    return entries;
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const id of ids) {
    if (!byId.has(id)) {
      throw new Error(`Unknown entry id: ${id}`);
    }
  }

  const requestedIds = new Set(ids);
  return entries.filter((entry) => requestedIds.has(entry.id));
}

function groupByRepoAndBranch(entries: ManifestEntry[]): Map<string, ManifestEntry[]> {
  const groups = new Map<string, ManifestEntry[]>();

  for (const entry of entries) {
    const key = `${entry.repo}#${entry.branch}`;
    const group = groups.get(key);

    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  return groups;
}

function printSummary(results: PullResult[]): void {
  if (results.length === 0) {
    console.log('No matching entries to pull.');
    return;
  }

  const statusWidth = Math.max(
    'unchanged'.length,
    ...results.map((result) => result.status.length),
  );
  const idWidth = Math.max(...results.map((result) => result.entry.id.length));

  for (const result of results) {
    if (result.status === 'error') {
      const errorText = result.error ?? 'Unknown error';
      console.log(
        `✗ ${'error'.padEnd(statusWidth)}  ${result.entry.id.padEnd(idWidth)}  ${errorText}`,
      );
      continue;
    }

    const marker = result.status === 'updated' ? '✓' : ' ';
    console.log(
      `${marker} ${result.status.padEnd(statusWidth)}  ${result.entry.id.padEnd(idWidth)}  ${result.entry.destination}`,
    );
  }
}

export async function pullCommand(ids: string[], options: PullOptions): Promise<void> {
  const { manifest } = requireManifest();
  const selectedEntries = selectEntries(manifest.entries, ids);
  const groups = groupByRepoAndBranch(selectedEntries);
  const results: PullResult[] = [];

  for (const groupEntries of groups.values()) {
    if (groupEntries.length === 0) {
      continue;
    }

    if (options.dryRun) {
      for (const entry of groupEntries) {
        console.log(
          `[dry-run] Would pull ${entry.source} from ${entry.repo} → ${entry.destination}`,
        );
        results.push({ entry, status: 'unchanged' });
      }
      continue;
    }

    let cacheDir: string;
    try {
      const first = groupEntries[0];
      cacheDir = await ensureCached(first.repo, first.branch);
    } catch (error) {
      const message = toErrorMessage(error);
      for (const entry of groupEntries) {
        results.push({
          entry,
          status: 'error',
          error: message,
        });
      }
      continue;
    }

    for (const entry of groupEntries) {
      try {
        const status = await syncEntry(entry, cacheDir);
        results.push({ entry, status });
      } catch (error) {
        results.push({
          entry,
          status: 'error',
          error: toErrorMessage(error),
        });
      }
    }
  }

  printSummary(results);

  if (results.some((result) => result.status === 'error')) {
    process.exit(1);
  }
}
