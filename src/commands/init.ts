import * as fs from 'node:fs';
import * as path from 'node:path';
import { getGlobalDfilesDir, MANIFEST_FILENAME, saveManifest } from '../config';
import type { Manifest } from '../types';

interface InitOptions {
  global?: boolean;
}

export async function initCommand(
  directory: string | undefined,
  options: InitOptions = {},
): Promise<void> {
  if (options.global && directory !== undefined) {
    throw new Error('Do not pass a directory with --global.');
  }

  const targetDir = options.global
    ? getGlobalDfilesDir()
    : path.resolve(directory ?? process.cwd());
  const manifestPath = path.join(targetDir, MANIFEST_FILENAME);

  if (fs.existsSync(manifestPath)) {
    throw new Error(`${MANIFEST_FILENAME} already exists in ${targetDir}`);
  }

  if (options.global) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const manifest: Manifest = {
    version: 1,
    entries: [],
  };

  saveManifest(targetDir, manifest);
  console.log(`Initialized empty dfiles manifest in ${manifestPath}`);
}
