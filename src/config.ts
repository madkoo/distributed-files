import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Manifest } from './types';

export const MANIFEST_FILENAME = 'dfiles.json';

/**
 * Replaces leading ~ with os.homedir(), then path.resolve().
 * This is the single cross-platform path normalizer used everywhere.
 */
export function resolvePath(p: string): string {
  const expandedPath =
    p === '~'
      ? os.homedir()
      : p.startsWith('~/') || p.startsWith('~\\')
        ? path.join(os.homedir(), p.slice(2))
        : p;

  return path.resolve(expandedPath);
}

/**
 * Walks up from process.cwd() checking for dfiles.json at each level.
 * Returns the directory path that contains dfiles.json, or null if not found.
 * Stops at filesystem root.
 */
export function findManifestDir(): string | null {
  let current = process.cwd();

  while (true) {
    const manifestPath = path.join(current, MANIFEST_FILENAME);
    if (fs.existsSync(manifestPath)) {
      try {
        if (fs.statSync(manifestPath).isFile()) {
          return current;
        }
      } catch {
        // Ignore filesystem race conditions and continue walking upward.
      }
    }

    const parent = path.dirname(current);
    if (current === parent) {
      return null;
    }

    current = parent;
  }
}

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeManifest = value as { version?: unknown; entries?: unknown };
  if (maybeManifest.version !== 1 || !Array.isArray(maybeManifest.entries)) {
    return false;
  }

  return maybeManifest.entries.every((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidate = entry as { [key: string]: unknown };
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.repo === 'string' &&
      typeof candidate.branch === 'string' &&
      typeof candidate.source === 'string' &&
      typeof candidate.destination === 'string'
    );
  });
}

/**
 * Reads and JSON-parses dfiles.json from `dir`.
 * Throws a descriptive error if not found or malformed.
 */
export function loadManifest(dir: string): Manifest {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Manifest file not found at "${manifestPath}". Run "dfiles init" in your project root first.`,
    );
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read or parse manifest at "${manifestPath}": ${message}`);
  }

  if (!isManifest(parsed)) {
    throw new Error(
      `Manifest at "${manifestPath}" is malformed. Expected shape: { "version": 1, "entries": ManifestEntry[] }.`,
    );
  }

  return parsed;
}

/**
 * Writes JSON.stringify(manifest, null, 2) to dfiles.json in `dir`.
 */
export function saveManifest(dir: string, manifest: Manifest): void {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Calls findManifestDir(), throws actionable error if null.
 * Used by all commands except `init`.
 */
export function requireManifest(): { dir: string; manifest: Manifest } {
  const dir = findManifestDir();
  if (!dir) {
    throw new Error(
      `No ${MANIFEST_FILENAME} found in this directory or any parent directory. Run "dfiles init" in your project root first.`,
    );
  }

  return {
    dir,
    manifest: loadManifest(dir),
  };
}
