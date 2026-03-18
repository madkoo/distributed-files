import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fg from 'fast-glob';
import { ManifestEntry } from './types';
import { resolvePath } from './config';

/**
 * Returns SHA-256 hash of file contents, or null if file doesn't exist.
 */
export function fileHash(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/** Returns true if the source path contains any glob metacharacter. */
export function isGlobPattern(source: string): boolean {
  return /[*?[\]{}]/.test(source);
}

/**
 * Returns the leading non-glob path segments joined with '/'.
 * e.g. 'skills/canvas/** /*.md' → 'skills/canvas'
 *      '*.md'                   → '.'
 */
export function globBase(pattern: string): string {
  const segments = pattern.split('/');
  const base: string[] = [];
  for (const seg of segments) {
    if (/[*?[\]{}]/.test(seg)) break;
    base.push(seg);
  }
  return base.length > 0 ? base.join('/') : '.';
}

/**
 * Syncs a single entry from its cached repo location to its destination.
 */
export async function syncEntry(
  entry: ManifestEntry,
  cacheDir: string
): Promise<'updated' | 'unchanged'> {
  const destPath = resolvePath(entry.destination);

  // Glob pattern: expand matches and copy each file preserving relative structure
  if (isGlobPattern(entry.source)) {
    const base = globBase(entry.source);
    const absBase = path.join(cacheDir, base);
    const matches = fg.sync(entry.source, { cwd: cacheDir, absolute: true, onlyFiles: true });

    if (matches.length === 0) {
      process.stderr.write(`Warning: glob "${entry.source}" matched no files in cache.\n`);
      return 'unchanged';
    }

    let anyUpdated = false;
    for (const absMatch of matches) {
      const relPath = path.relative(absBase, absMatch);
      const destFile = path.join(destPath, relPath);
      const sourceDigest = fileHash(absMatch);
      const destDigest = fileHash(destFile);

      if (sourceDigest !== null && sourceDigest === destDigest) {
        continue;
      }

      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(absMatch, destFile);
      anyUpdated = true;
    }
    return anyUpdated ? 'updated' : 'unchanged';
  }

  const sourcePath = path.join(cacheDir, entry.source);

  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(sourcePath);
  } catch {
    throw new Error(
      `Source path "${entry.source}" does not exist in cache "${cacheDir}" (resolved: "${sourcePath}").`
    );
  }

  if (sourceStat.isFile()) {
    const sourceDigest = fileHash(sourcePath);
    const destinationDigest = fileHash(destPath);

    if (sourceDigest !== null && sourceDigest === destinationDigest) {
      return 'unchanged';
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
    return 'updated';
  }

  if (sourceStat.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    fs.cpSync(sourcePath, destPath, { recursive: true });
    return 'updated';
  }

  throw new Error(
    `Source path "${sourcePath}" in cache is neither a regular file nor a directory and cannot be synced.`
  );
}