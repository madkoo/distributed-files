import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import { resolvePath } from './config';
import type { ManifestEntry } from './types';

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function resolveExistingPath(filePath: string): string {
  let currentPath = path.resolve(filePath);
  const unresolvedSegments: string[] = [];

  while (true) {
    try {
      return path.join(fs.realpathSync.native(currentPath), ...unresolvedSegments.reverse());
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }

      try {
        fs.lstatSync(currentPath);
      } catch (lstatError) {
        if (!hasErrorCode(lstatError, 'ENOENT')) {
          throw lstatError;
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
          throw error;
        }

        unresolvedSegments.push(path.basename(currentPath));
        currentPath = parentPath;
        continue;
      }

      throw error;
    }
  }
}

function isPathWithin(filePath: string, containingDir: string): boolean {
  const relativePath = path.relative(containingDir, filePath);

  return (
    relativePath === '' ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function assertNoEscapingSymlinks(filePath: string, label: string): void {
  const resolvedPath = path.resolve(filePath);
  const root = path.parse(resolvedPath).root;
  let currentPath = root;

  for (const segment of resolvedPath.slice(root.length).split(path.sep)) {
    if (segment === '') {
      continue;
    }

    const nextPath = path.join(currentPath, segment);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(nextPath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return;
      }
      throw error;
    }

    if (stats.isSymbolicLink()) {
      const canonicalParent = resolveExistingPath(currentPath);
      const canonicalTarget = resolveExistingPath(nextPath);
      if (!isPathWithin(canonicalTarget, canonicalParent)) {
        throw new Error(`${label} escapes the expected directory boundary.`);
      }
    }

    currentPath = nextPath;
  }
}

/**
 * Returns the canonical path if it is inside `containingDir`; otherwise, throws.
 */
export function assertPathWithin(filePath: string, containingDir: string, label: string): string {
  const resolved = resolveExistingPath(filePath);
  const base = resolveExistingPath(containingDir);

  if (!isPathWithin(resolved, base)) {
    throw new Error(`${label} escapes the expected directory boundary.`);
  }

  return resolved;
}

export function assertDestinationPath(filePath: string, label: string): string {
  const resolvedPath = path.resolve(filePath);
  assertNoEscapingSymlinks(resolvedPath, label);
  const canonicalPath = assertPathWithin(resolvedPath, path.dirname(resolvedPath), label);

  try {
    if (fs.lstatSync(resolvedPath).isSymbolicLink()) {
      throw new Error(`${label} is a symbolic link.`);
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error;
    }
  }

  return canonicalPath;
}

export function assertDirectoryCopyPaths(
  sourceDir: string,
  destinationDir: string,
  sourceRoot: string,
  destinationRoot: string,
): void {
  assertPathWithin(sourceDir, sourceRoot, `Source path "${sourceDir}"`);
  assertPathWithin(destinationDir, destinationRoot, `Destination path "${destinationDir}"`);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    assertPathWithin(sourcePath, sourceRoot, `Source path "${sourcePath}"`);
    assertPathWithin(destinationPath, destinationRoot, `Destination path "${destinationPath}"`);

    if (entry.isDirectory()) {
      assertDirectoryCopyPaths(sourcePath, destinationPath, sourceRoot, destinationRoot);
    }
  }
}

function copyDirectoryContents(
  sourceDir: string,
  destinationDir: string,
  sourceRoot: string,
  destinationRoot: string,
  activeDirectories = new Set<string>(),
): void {
  const canonicalSourceDir = assertPathWithin(sourceDir, sourceRoot, `Source path "${sourceDir}"`);
  const canonicalDestinationDir = assertPathWithin(
    destinationDir,
    destinationRoot,
    `Destination path "${destinationDir}"`,
  );

  if (activeDirectories.has(canonicalSourceDir)) {
    throw new Error(`Source directory "${sourceDir}" contains a circular symbolic link.`);
  }

  activeDirectories.add(canonicalSourceDir);
  fs.mkdirSync(canonicalDestinationDir, { recursive: true });

  try {
    for (const entry of fs.readdirSync(canonicalSourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(canonicalSourceDir, entry.name);
      const destinationPath = path.join(canonicalDestinationDir, entry.name);
      const canonicalSourcePath = assertPathWithin(
        sourcePath,
        sourceRoot,
        `Source path "${sourcePath}"`,
      );
      const canonicalDestinationPath = assertPathWithin(
        destinationPath,
        destinationRoot,
        `Destination path "${destinationPath}"`,
      );
      const stats = fs.statSync(canonicalSourcePath);

      if (stats.isDirectory()) {
        copyDirectoryContents(
          canonicalSourcePath,
          canonicalDestinationPath,
          sourceRoot,
          destinationRoot,
          activeDirectories,
        );
      } else if (stats.isFile()) {
        fs.copyFileSync(canonicalSourcePath, canonicalDestinationPath);
      } else {
        throw new Error(`Source path "${sourcePath}" cannot be copied.`);
      }
    }
  } finally {
    activeDirectories.delete(canonicalSourceDir);
  }
}

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
  const result = base.join('/');
  return result.length > 0 ? result : '.';
}

/**
 * Syncs a single entry from its cached repo location to its destination.
 */
export async function syncEntry(
  entry: ManifestEntry,
  cacheDir: string,
): Promise<'updated' | 'unchanged'> {
  const destPath = resolvePath(entry.destination);

  // Glob pattern: expand matches and copy each file preserving relative structure
  if (isGlobPattern(entry.source)) {
    const base = globBase(entry.source);
    const absBase = path.join(cacheDir, base);
    assertPathWithin(absBase, cacheDir, `Glob base "${base}"`);
    const matches = fg.sync(entry.source, { cwd: cacheDir, absolute: true, onlyFiles: true });

    if (matches.length === 0) {
      process.stderr.write(`Warning: glob "${entry.source}" matched no files in cache.\n`);
      return 'unchanged';
    }

    const destinationRoot = assertDestinationPath(
      destPath,
      `Destination path "${entry.destination}"`,
    );

    let anyUpdated = false;
    for (const absMatch of matches) {
      const sourcePath = assertPathWithin(absMatch, cacheDir, `Glob match "${absMatch}"`);
      const relPath = path.relative(absBase, absMatch);
      const destFile = path.join(destinationRoot, relPath);
      const canonicalDestFile = assertPathWithin(
        destFile,
        destinationRoot,
        `Destination file "${relPath}"`,
      );

      const sourceDigest = fileHash(sourcePath);
      const destDigest = fileHash(canonicalDestFile);

      if (sourceDigest !== null && sourceDigest === destDigest) {
        continue;
      }

      fs.mkdirSync(path.dirname(canonicalDestFile), { recursive: true });
      const sourceToCopy = assertPathWithin(absMatch, cacheDir, `Glob match "${absMatch}"`);
      const destinationToCopy = assertPathWithin(
        destFile,
        destinationRoot,
        `Destination file "${relPath}"`,
      );
      fs.copyFileSync(sourceToCopy, destinationToCopy);
      anyUpdated = true;
    }
    return anyUpdated ? 'updated' : 'unchanged';
  }

  const sourcePath = path.join(cacheDir, entry.source);
  const canonicalSourcePath = assertPathWithin(
    sourcePath,
    cacheDir,
    `Source path "${entry.source}"`,
  );
  const canonicalDestinationPath = assertDestinationPath(
    destPath,
    `Destination path "${entry.destination}"`,
  );

  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(canonicalSourcePath);
  } catch {
    throw new Error(
      `Source path "${entry.source}" does not exist in cache "${cacheDir}" (resolved: "${canonicalSourcePath}").`,
    );
  }

  if (sourceStat.isFile()) {
    const sourceForHash = assertPathWithin(sourcePath, cacheDir, `Source path "${entry.source}"`);
    const destinationForHash = assertDestinationPath(
      destPath,
      `Destination path "${entry.destination}"`,
    );
    const sourceDigest = fileHash(sourceForHash);
    const destinationDigest = fileHash(destinationForHash);

    if (sourceDigest !== null && sourceDigest === destinationDigest) {
      return 'unchanged';
    }

    fs.mkdirSync(path.dirname(destinationForHash), { recursive: true });
    const sourceToCopy = assertPathWithin(sourcePath, cacheDir, `Source path "${entry.source}"`);
    const destinationToCopy = assertDestinationPath(
      destPath,
      `Destination path "${entry.destination}"`,
    );
    fs.copyFileSync(sourceToCopy, destinationToCopy);
    return 'updated';
  }

  if (sourceStat.isDirectory()) {
    fs.mkdirSync(canonicalDestinationPath, { recursive: true });
    const sourceToCopy = assertPathWithin(sourcePath, cacheDir, `Source path "${entry.source}"`);
    const destinationToCopy = assertDestinationPath(
      destPath,
      `Destination path "${entry.destination}"`,
    );
    assertDirectoryCopyPaths(sourceToCopy, destinationToCopy, cacheDir, destinationToCopy);
    copyDirectoryContents(sourceToCopy, destinationToCopy, cacheDir, destinationToCopy);
    return 'updated';
  }

  throw new Error(
    `Source path "${sourcePath}" in cache is neither a regular file nor a directory and cannot be synced.`,
  );
}
