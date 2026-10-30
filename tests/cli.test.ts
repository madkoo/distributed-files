import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI package metadata', () => {
  it('registers the dfiles executable for global npm installs', () => {
    const repoRoot = process.cwd();
    const packageJson: {
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
    } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

    expect(packageJson.bin?.dfiles).toBe('./dist/index.js');
    expect(packageJson.files).toContain('dist');
    expect(packageJson.scripts?.prepublishOnly).toBe('npm run build');
    expect(fs.readFileSync(path.join(repoRoot, 'src', 'index.ts'), 'utf8')).toMatch(
      /^#!\/usr\/bin\/env node/,
    );
  });
});
