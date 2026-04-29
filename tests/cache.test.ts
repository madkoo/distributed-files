import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mock — must appear before the import of the module under test
// ---------------------------------------------------------------------------
const mockGit = {
  checkIsRepo: vi.fn(),
  fetch: vi.fn(),
  checkout: vi.fn(),
  pull: vi.fn(),
  reset: vi.fn(),
  clone: vi.fn(),
};

vi.mock('simple-git', () => ({ default: vi.fn(() => mockGit) }));

import { CACHE_BASE, ensureCached, getCacheDir, getRepoHash } from '../src/cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_URL = 'https://test.example.com/repo';
const BRANCH = 'main';

const tmpDirs: string[] = [];

afterEach(() => {
  tmpDirs.forEach((d) => {
    fs.rmSync(d, { recursive: true, force: true });
  });
  tmpDirs.length = 0;
  vi.restoreAllMocks();
});

beforeEach(() => {
  Object.values(mockGit).forEach((m) => {
    m.mockReset().mockResolvedValue(undefined);
  });
});

// ---------------------------------------------------------------------------
// Section A — utility functions
// ---------------------------------------------------------------------------

describe('getRepoHash', () => {
  it('returns a 16-character lowercase hex string', () => {
    // Arrange / Act
    const hash = getRepoHash('https://example.com');

    // Assert
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('getCacheDir', () => {
  it('returns path.join(CACHE_BASE, getRepoHash(url))', () => {
    // Arrange
    const url = 'https://example.com';

    // Act / Assert
    expect(getCacheDir(url)).toBe(path.join(CACHE_BASE, getRepoHash(url)));
  });
});

// ---------------------------------------------------------------------------
// Section B — not-cached path (ensureCached → clone branch)
// ---------------------------------------------------------------------------

describe('ensureCached — not-cached path', () => {
  it('calls clone with cacheDir and branch args and returns cacheDir when cacheDir does not exist', async () => {
    // Arrange — guarantee cacheDir is absent so existsSync returns false naturally
    const cacheDir = getCacheDir(TEST_URL);
    fs.rmSync(cacheDir, { recursive: true, force: true });

    // Act
    const result = await ensureCached(TEST_URL, BRANCH);

    // Assert
    expect(mockGit.clone).toHaveBeenCalledWith(TEST_URL, cacheDir, [
      '--depth',
      '1',
      '--branch',
      BRANCH,
    ]);
    expect(result).toBe(cacheDir);
  });

  it('removes corrupt cacheDir and calls clone when checkIsRepo returns false', async () => {
    // Arrange — create a real dir that is NOT a valid git repo
    const cacheDir = getCacheDir(TEST_URL);
    fs.mkdirSync(cacheDir, { recursive: true });
    tmpDirs.push(cacheDir);
    mockGit.checkIsRepo.mockResolvedValue(false);

    // Act
    await ensureCached(TEST_URL, BRANCH);

    // Assert — real rmSync ran so the dir is gone, then clone was called
    expect(fs.existsSync(cacheDir)).toBe(false);
    expect(mockGit.clone).toHaveBeenCalledWith(TEST_URL, cacheDir, [
      '--depth',
      '1',
      '--branch',
      BRANCH,
    ]);
  });

  it('throws an error containing "Failed to clone repository" when clone rejects', async () => {
    // Arrange — guarantee cacheDir is absent
    const cacheDir = getCacheDir(TEST_URL);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    mockGit.clone.mockRejectedValue(new Error('authentication required'));

    // Act / Assert
    await expect(ensureCached(TEST_URL, BRANCH)).rejects.toThrow('Failed to clone repository');
  });
});

// ---------------------------------------------------------------------------
// Sections C–F — cached path (cacheDir exists on disk, checkIsRepo → true)
// ---------------------------------------------------------------------------

describe('ensureCached — cached path', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = getCacheDir(TEST_URL);
    tmpDirs.push(cacheDir); // outer afterEach will clean this up
    fs.mkdirSync(path.join(cacheDir, '.git'), { recursive: true });
    mockGit.checkIsRepo.mockResolvedValue(true);
  });

  // ---- Section C: lock file handling ----------------------------------------

  describe('lock file handling', () => {
    it('calls fetch when no lock file is present', async () => {
      // Arrange — .git dir exists but no index.lock

      // Act
      await ensureCached(TEST_URL, BRANCH);

      // Assert
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', BRANCH, ['--depth', '1']);
    });

    it('removes the lock file before calling fetch', async () => {
      // Arrange — create a real lock file
      const lockFile = path.join(cacheDir, '.git', 'index.lock');
      fs.writeFileSync(lockFile, '');

      // Act
      await ensureCached(TEST_URL, BRANCH);

      // Assert — lock file was deleted by the real rmSync inside ensureCached
      expect(fs.existsSync(lockFile)).toBe(false);
      expect(mockGit.fetch).toHaveBeenCalled();
    });

    it('still calls fetch when lock file removal throws', async () => {
      // Arrange — create index.lock as a DIRECTORY so rmSync(lockFile, {force:true})
      // throws EISDIR (force only suppresses ENOENT, not directory errors).
      // The catch block in ensureCached swallows the error.
      const lockFile = path.join(cacheDir, '.git', 'index.lock');
      fs.mkdirSync(lockFile, { recursive: true });

      // Act
      await ensureCached(TEST_URL, BRANCH);

      // Assert
      expect(mockGit.fetch).toHaveBeenCalled();
    });
  });

  // ---- Section D: fetch errors -----------------------------------------------

  describe('fetch error handling', () => {
    it('resolves to cacheDir when fetch succeeds', async () => {
      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).resolves.toBe(cacheDir);
    });

    it('throws with "Branch" and "not found on remote" when fetch fails with "couldn\'t find remote ref"', async () => {
      // Arrange
      mockGit.fetch.mockRejectedValue(new Error("couldn't find remote ref main"));

      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).rejects.toThrow(/Branch.*not found on remote/);
    });

    it('throws with "Branch" and "not found on remote" when fetch fails with "invalid refspec"', async () => {
      // Arrange
      mockGit.fetch.mockRejectedValue(new Error("invalid refspec 'main'"));

      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).rejects.toThrow(/Branch.*not found on remote/);
    });

    it('throws with "Failed to update cached repository" when fetch fails with a generic error', async () => {
      // Arrange
      mockGit.fetch.mockRejectedValue(new Error('network timeout'));

      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).rejects.toThrow(
        'Failed to update cached repository',
      );
    });
  });

  // ---- Section E: checkout ---------------------------------------------------

  describe('checkout step', () => {
    it('calls checkout with ["-B", branch, "origin/<branch>"]', async () => {
      // Act
      await ensureCached(TEST_URL, BRANCH);

      // Assert
      expect(mockGit.checkout).toHaveBeenCalledWith(['-B', BRANCH, `origin/${BRANCH}`]);
    });

    it('throws with "Failed to checkout branch" when checkout rejects', async () => {
      // Arrange
      mockGit.checkout.mockRejectedValue(new Error('pathspec error'));

      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).rejects.toThrow('Failed to checkout branch');
    });
  });

  // ---- Section F: pull and fast-forward recovery -----------------------------

  describe('pull and fast-forward recovery', () => {
    it('returns cacheDir when pull succeeds', async () => {
      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).resolves.toBe(cacheDir);
    });

    it('returns cacheDir and does not call clone when pull fails with fast-forward error and reset succeeds', async () => {
      // Arrange
      mockGit.pull.mockRejectedValue(new Error('not possible to fast-forward'));

      // Act
      const result = await ensureCached(TEST_URL, BRANCH);

      // Assert
      expect(result).toBe(cacheDir);
      expect(mockGit.clone).not.toHaveBeenCalled();
    });

    it('calls clone as last resort and returns cacheDir when pull fails with fast-forward error and reset also rejects', async () => {
      // Arrange
      mockGit.pull.mockRejectedValue(new Error('not a fast-forward'));
      mockGit.reset.mockRejectedValue(new Error('reset failed'));

      // Act
      const result = await ensureCached(TEST_URL, BRANCH);

      // Assert
      expect(mockGit.clone).toHaveBeenCalled();
      expect(result).toBe(cacheDir);
    });

    it('throws with "Failed to re-clone repository" when pull fails, reset fails, and clone also rejects', async () => {
      // Arrange
      mockGit.pull.mockRejectedValue(new Error('not possible to fast-forward'));
      mockGit.reset.mockRejectedValue(new Error('reset failed'));
      mockGit.clone.mockRejectedValue(new Error('clone also failed'));

      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).rejects.toThrow('Failed to re-clone repository');
    });

    it('throws with "Failed to update cached repository" when pull fails with a non-fast-forward error', async () => {
      // Arrange
      mockGit.pull.mockRejectedValue(new Error('connection refused'));

      // Act / Assert
      await expect(ensureCached(TEST_URL, BRANCH)).rejects.toThrow(
        'Failed to update cached repository',
      );
    });
  });
});
