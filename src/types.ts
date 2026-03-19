/** One tracked file/directory entry in the manifest */
export interface ManifestEntry {
  /** Stable identifier, e.g. "canvas-design-skill" */
  id: string;
  /** Full remote URL: "https://github.com/org/repo" or "git@github.com:org/repo.git" */
  repo: string;
  /** Git branch, default "main" */
  branch: string;
  /** Repo-relative path, directory, or glob pattern: "skills/canvas-design/SKILL.md" or "skills/canvas-design/**" */
  source: string;
  /** Absolute or ~-prefixed local destination path */
  destination: string;
}

/** The dfiles.json file schema */
export interface Manifest {
  version: 1;
  entries: ManifestEntry[];
}

/** Result of a single pull operation */
export interface PullResult {
  entry: ManifestEntry;
  status: 'updated' | 'unchanged' | 'error';
  error?: string;
}

/** Result of a single status check (offline) */
export interface StatusResult {
  entry: ManifestEntry;
  state: 'current' | 'outdated' | 'missing';
}
