import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/cache', () => ({
  getCacheDir: vi.fn(),
  ensureCached: vi.fn(),
}));

import { getCacheDir } from '../src/cache';
import { determineState } from '../src/commands/status';
import type { ManifestEntry } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const tmpDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfiles-status-test-'));
  tmpDirs.push(dir);
  return dir;
}

function makeEntry(
  overrides: Partial<ManifestEntry> & { source: string; destination: string },
): ManifestEntry {
  return { id: 'test', repo: 'https://github.com/org/repo', branch: 'main', ...overrides };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// determineState — glob patterns
// ---------------------------------------------------------------------------
describe('determineState (glob patterns)', () => {
  it('returns missing when cache directory does not exist', () => {
    const cacheDir = path.join(os.tmpdir(), `nonexistent-cache-${Date.now()}`);
    const destDir = makeTempDir();
    vi.mocked(getCacheDir).mockReturnValue(cacheDir);

    expect(determineState(makeEntry({ source: 'skills/canvas/**', destination: destDir }))).toBe(
      'missing',
    );
  });

  it('returns missing when glob matches no files in cache', () => {
    const cacheDir = makeTempDir(); // exists but empty
    const destDir = makeTempDir();
    vi.mocked(getCacheDir).mockReturnValue(cacheDir);

    expect(determineState(makeEntry({ source: 'skills/canvas/**', destination: destDir }))).toBe(
      'missing',
    );
  });

  it('returns missing when a matched file is absent from destination', () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();
    vi.mocked(getCacheDir).mockReturnValue(cacheDir);

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Skill');
    // destDir exists but SKILL.md is not there

    expect(determineState(makeEntry({ source: 'skills/canvas/**', destination: destDir }))).toBe(
      'missing',
    );
  });

  it('returns outdated when a matched file differs from destination', () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();
    vi.mocked(getCacheDir).mockReturnValue(cacheDir);

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Updated Skill');
    fs.writeFileSync(path.join(destDir, 'SKILL.md'), '# Old Skill');

    expect(determineState(makeEntry({ source: 'skills/canvas/**', destination: destDir }))).toBe(
      'outdated',
    );
  });

  it('returns current when all matched files are identical to destination', () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();
    vi.mocked(getCacheDir).mockReturnValue(cacheDir);

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas/examples'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/examples/demo.md'), '# Demo');
    fs.mkdirSync(path.join(destDir, 'examples'), { recursive: true });
    fs.writeFileSync(path.join(destDir, 'SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(destDir, 'examples/demo.md'), '# Demo');

    expect(determineState(makeEntry({ source: 'skills/canvas/**', destination: destDir }))).toBe(
      'current',
    );
  });

  it('returns outdated when a nested file differs', () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();
    vi.mocked(getCacheDir).mockReturnValue(cacheDir);

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas/examples'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/examples/demo.md'), '# New Demo');
    fs.mkdirSync(path.join(destDir, 'examples'), { recursive: true });
    fs.writeFileSync(path.join(destDir, 'SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(destDir, 'examples/demo.md'), '# Old Demo');

    expect(determineState(makeEntry({ source: 'skills/canvas/**', destination: destDir }))).toBe(
      'outdated',
    );
  });
});
