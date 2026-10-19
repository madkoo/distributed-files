import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import { getCacheDir } from '../cache';
import { requireManifest, resolvePath } from '../config';
import {
  assertDestinationPath,
  assertDirectoryCopyPaths,
  assertPathWithin,
  fileHash,
  globBase,
  isGlobPattern,
} from '../sync';
import type { ManifestEntry, StatusResult } from '../types';

function collectDirectoryEntries(
  rootDir: string,
  currentDir: string,
  containmentRoot: string,
  entries: string[],
  activeDirectories: Set<string>,
): void {
  const canonicalDir = assertPathWithin(
    currentDir,
    containmentRoot,
    `Directory path "${currentDir}"`,
  );
  if (activeDirectories.has(canonicalDir)) {
    throw new Error(`Directory "${currentDir}" contains a circular symbolic link.`);
  }

  activeDirectories.add(canonicalDir);
  const children = fs.readdirSync(canonicalDir, { withFileTypes: true });

  try {
    for (const child of children) {
      const absolutePath = path.join(currentDir, child.name);
      const canonicalPath = assertPathWithin(
        absolutePath,
        containmentRoot,
        `Directory entry "${absolutePath}"`,
      );
      const stats = fs.statSync(canonicalPath);

      if (stats.isDirectory()) {
        collectDirectoryEntries(rootDir, absolutePath, containmentRoot, entries, activeDirectories);
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
      const digest = fileHash(canonicalPath) ?? '';
      entries.push(`${relativePath}:${digest}`);
    }
  } finally {
    activeDirectories.delete(canonicalDir);
  }
}

function directoryHash(dir: string, containmentRoot: string): string {
  const pairs: string[] = [];
  collectDirectoryEntries(dir, dir, containmentRoot, pairs, new Set());
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
  let destinationPath = resolvePath(entry.destination);

  if (!fs.existsSync(cacheDir)) {
    return 'missing';
  }

  try {
    destinationPath = assertDestinationPath(
      destinationPath,
      `Destination path "${entry.destination}"`,
    );
  } catch {
    return 'missing';
  }

  // Glob pattern: expand and check each matched file
  if (isGlobPattern(entry.source)) {
    if (!fs.existsSync(cacheDir)) return 'missing';
    const base = globBase(entry.source);
    const absBase = path.join(cacheDir, base);
    try {
      assertPathWithin(absBase, cacheDir, `Glob base "${base}"`);
    } catch {
      return 'missing';
    }
    const matches = fg.sync(entry.source, { cwd: cacheDir, absolute: true, onlyFiles: true });
    if (matches.length === 0) return 'missing';
    for (const absMatch of matches) {
      let sourceMatch: string;
      try {
        sourceMatch = assertPathWithin(absMatch, cacheDir, `Glob match "${absMatch}"`);
      } catch {
        return 'missing';
      }
      const relPath = path.relative(absBase, absMatch);
      const destFile = path.join(destinationPath, relPath);
      let canonicalDestFile: string;
      try {
        canonicalDestFile = assertPathWithin(
          destFile,
          destinationPath,
          `Destination file "${relPath}"`,
        );
      } catch {
        return 'missing';
      }
      if (!fs.existsSync(canonicalDestFile)) return 'missing';
      const sourceDigest = fileHash(sourceMatch);
      const destDigest = fileHash(canonicalDestFile);
      if (sourceDigest !== destDigest) return 'outdated';
    }
    return 'current';
  }

  let sourcePath: string;
  try {
    sourcePath = assertPathWithin(
      path.join(cacheDir, entry.source),
      cacheDir,
      `Source path "${entry.source}"`,
    );
  } catch {
    return 'missing';
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

    try {
      assertDirectoryCopyPaths(sourcePath, destinationPath, cacheDir, destinationPath);
    } catch {
      return 'missing';
    }

    try {
      const sourceDigest = directoryHash(sourcePath, cacheDir);
      const destinationDigest = directoryHash(destinationPath, destinationPath);
      return sourceDigest === destinationDigest ? 'current' : 'outdated';
    } catch {
      return 'missing';
    }
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
