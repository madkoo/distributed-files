#!/usr/bin/env node
import { Command } from 'commander';
import { addCommand } from './commands/add';
import { initCommand } from './commands/init';
import { listCommand } from './commands/list';
import { pullCommand } from './commands/pull';
import { statusCommand } from './commands/status';
import { requireManifest, saveManifest } from './config';

const program = new Command();

program
  .name('dfiles')
  .description('Manage specific files/folders from multiple git repositories')
  .version('1.0.0');

// init command
program
  .command('init')
  .description('Initialize a new dfiles manifest in a directory')
  .argument('[directory]', 'target directory (default: current directory)')
  .action(async (directory: string | undefined) => {
    await initCommand(directory);
  });

// add command
program
  .command('add')
  .description('Track a file or directory from a remote git repository')
  .argument('<repo>', 'git remote URL (https:// or git@)')
  .argument('<source>', 'path within the repository to track')
  .argument('<destination>', 'local destination path (supports ~)')
  .option('-b, --branch <branch>', 'git branch to use', 'main')
  .option('--id <id>', 'custom entry identifier')
  .action(
    async (
      repo: string,
      source: string,
      destination: string,
      options: { branch: string; id?: string },
    ) => {
      await addCommand(repo, source, destination, options);
    },
  );

// pull command
program
  .command('pull')
  .description('Pull latest versions of tracked files from their remote origins')
  .argument('[ids...]', 'specific entry IDs to pull (default: all)')
  .option('--dry-run', 'show what would be pulled without making changes')
  .action(async (ids: string[], options: { dryRun?: boolean }) => {
    await pullCommand(ids, options);
  });

// status command
program
  .command('status')
  .description('Show which tracked files are current, outdated, or missing (offline)')
  .action(async () => {
    await statusCommand();
  });

// list command
program
  .command('list')
  .description('List all tracked entries in the manifest')
  .option('--json', 'output as JSON')
  .action(async (options: { json?: boolean }) => {
    await listCommand(options);
  });

// remove command
program
  .command('remove')
  .description('Remove a tracked entry from the manifest by ID')
  .argument('<id>', 'entry ID to remove')
  .action(async (id: string) => {
    const { dir, manifest } = requireManifest();
    const entryIndex = manifest.entries.findIndex((entry) => entry.id === id);

    if (entryIndex === -1) {
      console.error(`Entry not found: ${id}`);
      process.exit(1);
    }

    manifest.entries.splice(entryIndex, 1);
    saveManifest(dir, manifest);
    console.log(`Removed entry '${id}'`);
  });

// Wrap execution to handle top-level async errors nicely
(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
})();
