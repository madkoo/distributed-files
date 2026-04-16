import * as fs from 'node:fs';
import * as path from 'node:path';
import { MANIFEST_FILENAME, saveManifest } from '../config';
import type { Manifest } from '../types';

export async function initCommand(directory: string | undefined): Promise<void> {
  const targetDir = path.resolve(directory ?? process.cwd());
  const manifestPath = path.join(targetDir, MANIFEST_FILENAME);

  if (fs.existsSync(manifestPath)) {
    throw new Error(`${MANIFEST_FILENAME} already exists in ${targetDir}`);
  }

  const manifest: Manifest = {
    version: 1,
    entries: [],
  };

  saveManifest(targetDir, manifest);
  console.log(`Initialized empty dfiles manifest in ${manifestPath}`);
}
