import * as path from 'node:path';
import { requireManifest, saveManifest } from '../config';
import type { ManifestEntry } from '../types';

interface AddOptions {
  branch: string;
  id?: string;
}

function isPlausibleRepoUrl(repo: string): boolean {
  return repo.startsWith('https://') || repo.startsWith('git@');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function repoNameFromUrl(repo: string): string {
  const trimmed = repo.replace(/\/+$/, '');
  const lastSegment = trimmed.split('/').pop() ?? trimmed;
  return lastSegment.replace(/\.git$/i, '');
}

function generateEntryId(repo: string, source: string, existingIds: Set<string>): string {
  const repoName = repoNameFromUrl(repo);
  const sourceBase = path.basename(source);
  const baseId = slugify(`${repoName}-${sourceBase}`) || 'entry';

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

export async function addCommand(
  repo: string,
  source: string,
  destination: string,
  options: AddOptions,
): Promise<void> {
  const { dir, manifest } = requireManifest();

  if (!isPlausibleRepoUrl(repo)) {
    throw new Error('Repository must start with "https://" or "git@".');
  }

  const duplicate = manifest.entries.find(
    (entry) => entry.repo === repo && entry.source === source && entry.destination === destination,
  );

  if (duplicate) {
    throw new Error(`Entry already exists (id: ${duplicate.id})`);
  }

  const existingIds = new Set(manifest.entries.map((entry) => entry.id));
  const requestedId = options.id?.trim();
  const id = requestedId || generateEntryId(repo, source, existingIds);

  if (existingIds.has(id)) {
    throw new Error(`Entry id already exists: ${id}`);
  }

  const newEntry: ManifestEntry = {
    id,
    repo,
    branch: options.branch || 'main',
    source,
    destination,
  };

  manifest.entries.push(newEntry);
  saveManifest(dir, manifest);

  console.log(`Added entry '${id}': ${source} from ${repo} → ${destination}`);
}
