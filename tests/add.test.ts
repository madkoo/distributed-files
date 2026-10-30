import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCommand } from '../src/commands/add';
import { getGlobalDfilesDir, MANIFEST_FILENAME } from '../src/config';

const { mockHomedir } = vi.hoisted(() => ({ mockHomedir: vi.fn() }));

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, homedir: mockHomedir };
});

const tempDirs: string[] = [];
let homeDir: string;
let addingDir: string;
let pullingDir: string;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfiles-add-test-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  homeDir = makeTempDir();
  addingDir = makeTempDir();
  pullingDir = makeTempDir();
  mockHomedir.mockReturnValue(homeDir);
  vi.spyOn(process, 'cwd').mockReturnValue(addingDir);
  fs.mkdirSync(getGlobalDfilesDir(), { recursive: true });
  fs.writeFileSync(
    path.join(getGlobalDfilesDir(), MANIFEST_FILENAME),
    JSON.stringify({ version: 1, entries: [] }),
    'utf8',
  );
});

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  vi.restoreAllMocks();
});

describe('addCommand with a global manifest', () => {
  it('resolves a relative destination from the directory where it was added', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await addCommand('https://example.com/repo', 'settings.json', './settings.json', {
      branch: 'main',
    });

    vi.mocked(process.cwd).mockReturnValue(pullingDir);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(getGlobalDfilesDir(), MANIFEST_FILENAME), 'utf8'),
    );

    expect(manifest.entries[0].destination).toBe(path.join(addingDir, 'settings.json'));
  });
});
