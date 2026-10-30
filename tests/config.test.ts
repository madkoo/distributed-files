import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init';
import {
  findManifestDir,
  getGlobalDfilesDir,
  MANIFEST_FILENAME,
  requireManifest,
} from '../src/config';
import type { Manifest } from '../src/types';

const { mockHomedir } = vi.hoisted(() => ({ mockHomedir: vi.fn() }));

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, homedir: mockHomedir };
});

const tempDirs: string[] = [];
let homeDir: string;
let workingDir: string;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfiles-config-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(dir: string, entries: Manifest['entries'] = []): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, MANIFEST_FILENAME),
    JSON.stringify({ version: 1, entries }),
    'utf8',
  );
}

beforeEach(() => {
  homeDir = makeTempDir();
  workingDir = makeTempDir();
  mockHomedir.mockReturnValue(homeDir);
  vi.spyOn(process, 'cwd').mockReturnValue(workingDir);
});

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  vi.restoreAllMocks();
});

describe('findManifestDir', () => {
  it('uses the global manifest when no project manifest exists', () => {
    const globalDir = getGlobalDfilesDir();
    const entries: Manifest['entries'] = [
      {
        id: 'global-entry',
        repo: 'https://example.com/repo',
        branch: 'main',
        source: 'file.txt',
        destination: '~/file.txt',
      },
    ];
    writeManifest(globalDir, entries);

    expect(findManifestDir()).toBe(globalDir);
    expect(requireManifest()).toEqual({
      dir: globalDir,
      manifest: { version: 1, entries },
    });
  });

  it('prefers a project manifest over the global manifest', () => {
    const globalDir = getGlobalDfilesDir();
    writeManifest(globalDir);
    writeManifest(workingDir);

    expect(findManifestDir()).toBe(workingDir);
  });

  it('returns null when no project or global manifest exists', () => {
    expect(findManifestDir()).toBeNull();
  });
});

describe('initCommand --global', () => {
  it('creates the global directory and manifest', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await initCommand(undefined, { global: true });

    const manifestPath = path.join(getGlobalDfilesDir(), MANIFEST_FILENAME);
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).toEqual({
      version: 1,
      entries: [],
    });
  });

  it('rejects a directory when --global is used', async () => {
    await expect(initCommand(workingDir, { global: true })).rejects.toThrow(
      'Do not pass a directory with --global.',
    );
  });
});
