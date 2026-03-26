import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import simpleGit from 'simple-git';

export const CACHE_BASE = path.join(os.homedir(), '.dfiles', 'cache');

/**
 * SHA-256 of repoUrl, first 16 hex chars. Deterministic, collision-resistant.
 */
export function getRepoHash(repoUrl: string): string {
  return crypto.createHash('sha256').update(repoUrl).digest('hex').slice(0, 16);
}

/**
 * Returns path.join(CACHE_BASE, getRepoHash(repoUrl))
 */
export function getCacheDir(repoUrl: string): string {
  return path.join(CACHE_BASE, getRepoHash(repoUrl));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Main function: ensures repo is cloned and up-to-date.
 *
 * Steps:
 * 1. fs.mkdirSync(CACHE_BASE, { recursive: true })
 * 2. Check if cacheDir exists AND is a valid git repo (use simpleGit(cacheDir).checkIsRepo())
 *    - If checkIsRepo throws or the dir doesn't exist: treat as "not cached"
 * 3. If NOT cached:
 *    - If cacheDir exists but is corrupt: delete it first (fs.rmSync with { recursive: true, force: true })
 *    - Clone: await simpleGit().clone(repoUrl, cacheDir, ['--depth', '1', '--branch', branch])
 * 4. If cached:
 *    - const git = simpleGit(cacheDir)
 *    - await git.fetch('origin', branch)
 *    - await git.checkout(branch)
 *    - await git.pull('origin', branch)
 * 5. Returns cacheDir
 *
 * Errors from simple-git are re-thrown with context.
 */
export async function ensureCached(repoUrl: string, branch: string): Promise<string> {
  fs.mkdirSync(CACHE_BASE, { recursive: true });

  const cacheDir = getCacheDir(repoUrl);
  const cacheDirExists = fs.existsSync(cacheDir);
  let isCached = false;

  if (cacheDirExists) {
    try {
      const stat = fs.statSync(cacheDir);
      if (stat.isDirectory()) {
        isCached = await simpleGit(cacheDir).checkIsRepo();
      }
    } catch {
      isCached = false;
    }
  }

  if (!isCached) {
    if (cacheDirExists) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }

    try {
      await simpleGit().clone(repoUrl, cacheDir, ['--depth', '1', '--branch', branch]);
    } catch (error) {
      throw new Error(
        `Failed to clone repository "${repoUrl}" (branch "${branch}") into cache "${cacheDir}": ${toErrorMessage(error)}`
      );
    }

    return cacheDir;
  }

  const git = simpleGit(cacheDir);

  // Step 1: clear any stale index lock left by a previously interrupted operation
  const lockFile = path.join(cacheDir, '.git', 'index.lock');
  if (fs.existsSync(lockFile)) {
    try {
      fs.rmSync(lockFile, { force: true });
    } catch {
      // ignore — if we can't remove the lock, the subsequent git operation will
      // surface its own error (e.g. "Unable to lock index file")
    }
  }

  // Step 2: fetch with --depth 1 to avoid deepening the shallow clone
  try {
    await git.fetch('origin', branch, ['--depth', '1']);
  } catch (error) {
    const msg = toErrorMessage(error);
    // Branch deleted or renamed on remote — re-clone won't help either, surface clearly
    if (/couldn't find remote ref|invalid refspec/i.test(msg)) {
      throw new Error(
        `Branch "${branch}" not found on remote "${repoUrl}". It may have been deleted or renamed.`
      );
    }
    throw new Error(
      `Failed to update cached repository "${repoUrl}" (branch "${branch}") at "${cacheDir}": ${msg}`
    );
  }

  // Step 3: checkout the branch (create local tracking branch if needed, reset if detached)
  try {
    await git.checkout(['-B', branch, `origin/${branch}`]);
  } catch (error) {
    throw new Error(
      `Failed to checkout branch "${branch}" in cached repository "${repoUrl}" at "${cacheDir}": ${toErrorMessage(error)}`
    );
  }

  // Step 4: try pull; on fast-forward failure use reset --hard (no extra network call)
  try {
    await git.pull('origin', branch);
  } catch (error) {
    const msg = toErrorMessage(error);
    if (/not possible to fast.forward|not a fast.forward/i.test(msg)) {
      // Primary recovery: reset to the already-fetched remote tip
      try {
        await git.reset(['--hard', `origin/${branch}`]);
      } catch {
        // Last resort: corrupt local repo — wipe and re-clone
        fs.rmSync(cacheDir, { recursive: true, force: true });
        try {
          await simpleGit().clone(repoUrl, cacheDir, ['--depth', '1', '--branch', branch]);
        } catch (cloneError) {
          throw new Error(
            `Failed to re-clone repository "${repoUrl}" (branch "${branch}") after unrecoverable cache state: ${toErrorMessage(cloneError)}`
          );
        }
      }
    } else {
      throw new Error(
        `Failed to update cached repository "${repoUrl}" (branch "${branch}") at "${cacheDir}": ${msg}`
      );
    }
  }

  return cacheDir;
}
