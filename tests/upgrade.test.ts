import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockSpawn, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const child = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
  };

  return {
    listeners,
    mockSpawn: vi.fn(() => child),
  };
});

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { upgradeCommand } from '../src/commands/upgrade';

afterEach(() => {
  vi.restoreAllMocks();
  mockSpawn.mockClear();
  listeners.clear();
});

describe('upgradeCommand', () => {
  it('installs the latest published package globally', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const upgrade = upgradeCommand();

    expect(mockSpawn).toHaveBeenCalledWith(
      'npm',
      ['install', '--global', '@madkoo/dfiles@latest'],
      { stdio: 'inherit', shell: process.platform === 'win32' },
    );

    listeners.get('close')?.(0);

    await expect(upgrade).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('dfiles upgrade complete.');
  });

  it('rejects when npm exits with a non-zero code', async () => {
    const upgrade = upgradeCommand();
    listeners.get('close')?.(1);

    await expect(upgrade).rejects.toThrow('npm install failed with exit code 1');
  });

  it('rejects when npm cannot be started', async () => {
    const upgrade = upgradeCommand();
    const error = new Error('npm not found');
    listeners.get('error')?.(error);

    await expect(upgrade).rejects.toBe(error);
  });
});
