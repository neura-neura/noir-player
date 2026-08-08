import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('plugin scaffold', () => {
  it('supports a safe dry run without touching the workspace', () => {
    const output = execFileSync(process.execPath, ['scripts/create-plugin.mjs', 'contract-plugin', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output).toContain('Would create');
    expect(output).toContain('plugin-contract-plugin');
  });
});
