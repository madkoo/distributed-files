import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import { getCacheDir } from '../cache';
import { requireManifest, resolvePath } from '../config';
import { fileHash, globBase, isGlobPattern } from '../sync';
import type { ManifestEntry, StatusResult } from '../types';

function collectDirectoryEntries(rootDir: string, currentDir: string, entries: string[]): void {
  const children = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const child of children) {
    const absolutePath = path.join(currentDir, child.name);

    if (child.isDirectory()) {
      collectDirectoryEntries(rootDir, absolutePath, entries);
      continue;
    }

    if (!child.isFile()) {
      continue;
    }

    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    const digest = fileHash(absolutePath) ?? '';
    entries.push(`${relativePath}:${digest}`);
  }
}

function directoryHash(dir: string): string {
  const pairs: string[] = [];
  collectDirectoryEntries(dir, dir, pairs);
  pairs.sort();

  const combined = pairs.join('\n');
  return crypto.createHash('sha256').update(combined).digest('hex');
}

function stateLabel(state: StatusResult['state']): string {
  if (state === 'outdated') {
    return '!outdated';
  }

  if (state === 'missing') {
    return '?missing';
  }

  return 'current';
}

export function determineState(entry: ManifestEntry): StatusResult['state'] {
  const cacheDir = getCacheDir(entry.repo);
  const sourcePath = path.join(cacheDir, entry.source);
  const destinationPath = resolvePath(entry.destination);

  if (!fs.existsSync(cacheDir)) {
    return 'missing';
  }

  // Glob pattern: expand and check each matched file
  if (isGlobPattern(entry.source)) {
    if (!fs.existsSync(cacheDir)) return 'missing';
    const base = globBase(entry.source);
    const absBase = path.join(cacheDir, base);
    const matches = fg.sync(entry.source, { cwd: cacheDir, absolute: true, onlyFiles: true });
    if (matches.length === 0) return 'missing';
    for (const absMatch of matches) {
      const relPath = path.relative(absBase, absMatch);
      const destFile = path.join(destinationPath, relPath);
      if (!fs.existsSync(destFile)) return 'missing';
      const sourceDigest = fileHash(absMatch);
      const destDigest = fileHash(destFile);
      if (sourceDigest !== destDigest) return 'outdated';
    }
    return 'current';
  }

  if (!fs.existsSync(destinationPath)) {
    return 'missing';
  }

  if (!fs.existsSync(sourcePath)) {
    return 'missing';
  }

  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(sourcePath);
  } catch {
    return 'missing';
  }

  if (sourceStat.isFile()) {
    const sourceDigest = fileHash(sourcePath);
    const destinationDigest = fileHash(destinationPath);
    return sourceDigest !== null && sourceDigest === destinationDigest ? 'current' : 'outdated';
  }

  if (sourceStat.isDirectory()) {
    try {
      if (!fs.statSync(destinationPath).isDirectory()) {
        return 'outdated';
      }
    } catch {
      return 'missing';
    }

    const sourceDigest = directoryHash(sourcePath);
    const destinationDigest = directoryHash(destinationPath);
    return sourceDigest === destinationDigest ? 'current' : 'outdated';
  }

  return 'missing';
}

export async function statusCommand(): Promise<void> {
  const { manifest } = requireManifest();

  if (manifest.entries.length === 0) {
    console.log("No entries tracked. Use 'dfiles add' to start.");
    return;
  }

  const results: StatusResult[] = manifest.entries.map((entry) => ({
    entry,
    state: determineState(entry),
  }));

  const headers = ['ID', 'STATE', 'SOURCE', 'DESTINATION'] as const;
  const rows = results.map((result) => [
    result.entry.id,
    stateLabel(result.state),
    result.entry.source,
    result.entry.destination,
  ]);

  const widths = headers.map((header, index) => {
    return Math.max(header.length, ...rows.map((row) => row[index].length));
  });

  const formatRow = (values: readonly string[]): string => {
    return values.map((value, index) => value.padEnd(widths[index])).join('  ');
  };

  console.log(formatRow(headers));

  const separatorWidth = widths.reduce((sum, width) => sum + width, 0) + 2 * (headers.length - 1);
  console.log('─'.repeat(separatorWidth));

  for (const row of rows) {
    console.log(formatRow(row));
  }
}
