import { spawn } from 'node:child_process';

export async function upgradeCommand(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const installer = spawn('npm', ['install', '--global', '@madkoo/dfiles@latest'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    installer.on('error', reject);
    installer.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`npm install failed with exit code ${code}`));
        return;
      }

      console.log('dfiles upgrade complete.');
      resolve();
    });
  });
}
