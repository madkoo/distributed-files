import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globBase, isGlobPattern, syncEntry } from '../src/sync';

// ---------------------------------------------------------------------------
// isGlobPattern
// ---------------------------------------------------------------------------
describe('isGlobPattern', () => {
  it.each([
    ['*.md', true],
    ['src/**/*.ts', true],
    ['skills/canvas/**', true],
    ['skills/canvas/*.md', true],
    ['skills/canvas/**/*.md', true],
    ['file?.md', true],
    ['file[1].md', true],
    ['{a,b}.md', true],
    ['file.txt', false],
    ['path/to/file', false],
    ['skills/canvas/SKILL.md', false],
    ['', false],
  ])('isGlobPattern(%s) === %s', (input, expected) => {
    expect(isGlobPattern(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// globBase
// ---------------------------------------------------------------------------
describe('globBase', () => {
  it.each([
    ['skills/canvas/**', 'skills/canvas'],
    ['skills/canvas/**/*.md', 'skills/canvas'],
    ['skills/canvas/*', 'skills/canvas'],
    ['skills/canvas/*.md', 'skills/canvas'],
    ['skills/*/SKILL.md', 'skills'],
    ['*.md', '.'],
    ['**', '.'],
    ['', '.'],
  ])('globBase(%s) === %s', (input, expected) => {
    expect(globBase(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// syncEntry — glob paths (real temp filesystem)
// ---------------------------------------------------------------------------
describe('syncEntry (glob patterns)', () => {
  const tmpDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfiles-sync-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('copies all matched files preserving directory structure', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas/examples'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/examples/demo.md'), '# Demo');

    const result = await syncEntry(
      {
        id: 'test',
        repo: 'https://github.com/org/repo',
        branch: 'main',
        source: 'skills/canvas/**',
        destination: destDir,
      },
      cacheDir,
    );

    expect(result).toBe('updated');
    expect(fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf8')).toBe('# Skill');
    expect(fs.readFileSync(path.join(destDir, 'examples/demo.md'), 'utf8')).toBe('# Demo');
  });

  it('returns unchanged when all glob-matched files are already identical', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(destDir, 'SKILL.md'), '# Skill');

    const result = await syncEntry(
      {
        id: 'test',
        repo: 'https://github.com/org/repo',
        branch: 'main',
        source: 'skills/canvas/**',
        destination: destDir,
      },
      cacheDir,
    );

    expect(result).toBe('unchanged');
  });

  it('returns updated only for changed files and skips identical ones', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Updated Skill');
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/README.md'), '# Readme');
    fs.writeFileSync(path.join(destDir, 'SKILL.md'), '# Old Skill');
    fs.writeFileSync(path.join(destDir, 'README.md'), '# Readme');

    const result = await syncEntry(
      {
        id: 'test',
        repo: 'https://github.com/org/repo',
        branch: 'main',
        source: 'skills/canvas/**',
        destination: destDir,
      },
      cacheDir,
    );

    expect(result).toBe('updated');
    expect(fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf8')).toBe('# Updated Skill');
    expect(fs.readFileSync(path.join(destDir, 'README.md'), 'utf8')).toBe('# Readme');
  });

  it('returns unchanged and writes warning when glob matches no files', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await syncEntry(
      {
        id: 'test',
        repo: 'https://github.com/org/repo',
        branch: 'main',
        source: 'nonexistent/**',
        destination: destDir,
      },
      cacheDir,
    );

    expect(result).toBe('unchanged');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('matched no files'));
    stderrSpy.mockRestore();
  });

  it('copies only files matching extension filter', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/image.png'), 'binary');

    await syncEntry(
      {
        id: 'test',
        repo: 'https://github.com/org/repo',
        branch: 'main',
        source: 'skills/canvas/*.md',
        destination: destDir,
      },
      cacheDir,
    );

    expect(fs.existsSync(path.join(destDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'image.png'))).toBe(false);
  });
});
