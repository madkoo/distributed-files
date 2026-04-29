import { requireManifest } from '../config';

interface ListOptions {
  json?: boolean;
}

type ColumnName = 'ID' | 'REPO' | 'BRANCH' | 'SOURCE' | 'DESTINATION';

const MAX_COLUMN_VALUE = 40;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const { manifest } = requireManifest();

  if (options.json) {
    console.log(JSON.stringify(manifest.entries, null, 2));
    return;
  }

  if (manifest.entries.length === 0) {
    console.log("No entries. Use 'dfiles add' to track files.");
    return;
  }

  const columns: ColumnName[] = ['ID', 'REPO', 'BRANCH', 'SOURCE', 'DESTINATION'];

  const rows: Record<ColumnName, string>[] = manifest.entries.map((entry) => ({
    ID: entry.id,
    REPO: truncate(entry.repo, MAX_COLUMN_VALUE),
    BRANCH: entry.branch,
    SOURCE: entry.source,
    DESTINATION: truncate(entry.destination, MAX_COLUMN_VALUE),
  }));

  const widths = columns.map((column) => {
    return Math.max(column.length, ...rows.map((row) => row[column].length));
  });

  const formatRow = (values: string[]): string => {
    return values.map((value, index) => value.padEnd(widths[index])).join('  ');
  };

  console.log(formatRow(columns));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));

  for (const row of rows) {
    console.log(formatRow(columns.map((column) => row[column])));
  }
}
