import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPathWithin, globBase, isGlobPattern, syncEntry } from '../src/sync';

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

describe('assertPathWithin', () => {
  it('allows descendants of a filesystem root', () => {
    const root = path.parse(process.cwd()).root;

    expect(() =>
      assertPathWithin(path.join(root, 'dfiles-root-child-test'), root, 'Path'),
    ).not.toThrow();
  });

  it('rejects paths outside the containing directory', () => {
    const root = path.parse(process.cwd()).root;

    expect(() =>
      assertPathWithin(
        path.join(root, 'dfiles-containment-outside-test'),
        path.join(root, 'dfiles-containment-root-test'),
        'Path',
      ),
    ).toThrow(/escapes the expected directory boundary/);
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

  it('rejects a destination symlink ancestor when the target file does not exist', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();
    const outsideDir = makeTempDir();

    fs.mkdirSync(path.join(cacheDir, 'skills/canvas/external'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'skills/canvas/external/file.md'), '# External');
    fs.symlinkSync(outsideDir, path.join(destDir, 'external'), 'dir');

    await expect(
      syncEntry(
        {
          id: 'test',
          repo: 'https://github.com/org/repo',
          branch: 'main',
          source: 'skills/canvas/**',
          destination: destDir,
        },
        cacheDir,
      ),
    ).rejects.toThrow(/escapes the expected directory boundary/);

    expect(fs.existsSync(path.join(outsideDir, 'file.md'))).toBe(false);
  });
});

describe('syncEntry (path validation)', () => {
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

  it('rejects source symlinks that resolve outside the cache', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();
    const outsideDir = makeTempDir();
    const outsideFile = path.join(outsideDir, 'source.txt');
    const destination = path.join(destDir, 'source.txt');

    fs.writeFileSync(outsideFile, 'external content');
    fs.symlinkSync(outsideFile, path.join(cacheDir, 'source.txt'), 'file');

    await expect(
      syncEntry(
        {
          id: 'test',
          repo: 'https://github.com/org/repo',
          branch: 'main',
          source: 'source.txt',
          destination,
        },
        cacheDir,
      ),
    ).rejects.toThrow(/escapes the expected directory boundary/);

    expect(fs.existsSync(destination)).toBe(false);
  });

  it('does not overwrite a destination symlink target outside the destination', async () => {
    const cacheDir = makeTempDir();
    const destDir = makeTempDir();
    const outsideDir = makeTempDir();
    const sourcePath = path.join(cacheDir, 'source.txt');
    const outsideFile = path.join(outsideDir, 'target.txt');
    const destination = path.join(destDir, 'source.txt');

    fs.writeFileSync(sourcePath, 'new content');
    fs.writeFileSync(outsideFile, 'keep this content');
    fs.symlinkSync(outsideFile, destination, 'file');

    await expect(
      syncEntry(
        {
          id: 'test',
          repo: 'https://github.com/org/repo',
          branch: 'main',
          source: 'source.txt',
          destination,
        },
        cacheDir,
      ),
    ).rejects.toThrow();

    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('keep this content');
  });

  it('rejects a missing destination below an escaping symlink ancestor', async () => {
    const cacheDir = makeTempDir();
    const destinationParent = makeTempDir();
    const outsideDir = makeTempDir();
    const destination = path.join(destinationParent, 'external/source.txt');

    fs.writeFileSync(path.join(cacheDir, 'source.txt'), 'source content');
    fs.symlinkSync(outsideDir, path.join(destinationParent, 'external'), 'dir');

    await expect(
      syncEntry(
        {
          id: 'test',
          repo: 'https://github.com/org/repo',
          branch: 'main',
          source: 'source.txt',
          destination,
        },
        cacheDir,
      ),
    ).rejects.toThrow(/escapes the expected directory boundary/);

    expect(fs.existsSync(path.join(outsideDir, 'source.txt'))).toBe(false);
  });

  it('copies directories when destination paths stay within the destination', async () => {
    const cacheDir = makeTempDir();
    const destinationParent = makeTempDir();
    const sourceDir = path.join(cacheDir, 'assets');
    const destination = path.join(destinationParent, 'assets');

    fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'nested/file.txt'), 'file content');

    const result = await syncEntry(
      {
        id: 'test',
        repo: 'https://github.com/org/repo',
        branch: 'main',
        source: 'assets',
        destination,
      },
      cacheDir,
    );

    expect(result).toBe('updated');
    expect(fs.readFileSync(path.join(destination, 'nested/file.txt'), 'utf8')).toBe('file content');
  });

  it('copies internal symlinks as files so repeated directory syncs stay within the destination', async () => {
    const cacheDir = makeTempDir();
    const destinationParent = makeTempDir();
    const sourceDir = path.join(cacheDir, 'assets');
    const destination = path.join(destinationParent, 'assets');
    const target = path.join(sourceDir, 'target.txt');

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(target, 'file content');
    fs.symlinkSync(target, path.join(sourceDir, 'alias.txt'), 'file');

    const entry = {
      id: 'test',
      repo: 'https://github.com/org/repo',
      branch: 'main',
      source: 'assets',
      destination,
    };

    await syncEntry(entry, cacheDir);
    await expect(syncEntry(entry, cacheDir)).resolves.toBe('updated');

    expect(fs.lstatSync(path.join(destination, 'alias.txt')).isFile()).toBe(true);
    expect(fs.readFileSync(path.join(destination, 'alias.txt'), 'utf8')).toBe('file content');
  });

  it('rejects directory copies through a destination symlink ancestor', async () => {
    const cacheDir = makeTempDir();
    const destination = makeTempDir();
    const outsideDir = makeTempDir();
    const sourceDir = path.join(cacheDir, 'assets');

    fs.mkdirSync(path.join(sourceDir, 'external'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'external/file.txt'), 'external content');
    fs.symlinkSync(outsideDir, path.join(destination, 'external'), 'dir');

    await expect(
      syncEntry(
        {
          id: 'test',
          repo: 'https://github.com/org/repo',
          branch: 'main',
          source: 'assets',
          destination,
        },
        cacheDir,
      ),
    ).rejects.toThrow(/escapes the expected directory boundary/);

    expect(fs.existsSync(path.join(outsideDir, 'file.txt'))).toBe(false);
  });
});
