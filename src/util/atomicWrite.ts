/**
 * Write-then-rename, so a run killed mid-write cannot leave a half-written
 * `seen.json` or a truncated archive page. The temp file is created in the same
 * directory as the target: `rename` is only atomic within a filesystem.
 */
import { mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

export function atomicWriteFile(path: string, contents: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(temp, contents, { encoding: 'utf8', mode: 0o644 });
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file may never have been created. Nothing to clean up.
    }
    throw error;
  }
}

export function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
