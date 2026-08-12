import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { manifest, sources, trackedSources } from '../../tools/prose-triage.js';

function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'triage-'));
    for (const [name, body] of Object.entries(files)) {
        const path = join(dir, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, body);
    }
    return dir;
}

test('files without comments are omitted', () => {
    const dir = tree({ 'bare.ts': 'export const a = 1;\n', 'noted.ts': '// one\nexport const b = 2;\n' });
    const rows = manifest(dir);
    expect(rows.map(r => r.file.split('/').pop())).toEqual(['noted.ts']);
    expect(rows[0].comments).toBe(1);
});

test('rows are sorted by errors then comments, descending', () => {
    const dir = tree({
        'clean.ts': '// one\n// two\n// three\n// four\nexport const a = 1;\n',
        'dirty.ts': '// this is actually crucial\nexport const b = 2;\n'
    });
    const rows = manifest(dir);
    expect(rows.map(r => r.file.split('/').pop())).toEqual(['dirty.ts', 'clean.ts']);
    expect(rows[0].errors).toBe(2);
    expect(rows[1].errors).toBe(0);
});

test('warnings are not counted as errors', () => {
    const dir = tree({ 'soft.ts': '// the whole thing is really slow\nexport const a = 1;\n' });
    expect(manifest(dir)[0].errors).toBe(0);
});

test('multi-line blocks are counted', () => {
    const dir = tree({ 'block.ts': '// one\n// two\n// three\nexport const a = 1;\n' });
    const rows = manifest(dir);
    expect(rows[0].blocks).toBe(1);
    expect(rows[0].comments).toBe(3);
});

test('a root inside the repository is enumerated from git', () => {
    const found = sources('.');
    expect(found).toContain('tools/lint-prose-extras.ts');
    expect(found.filter(f => f.startsWith('node_modules/'))).toEqual([]);
    expect(found.every(f => f.endsWith('.ts'))).toBe(true);
});

test('a root outside the repository falls back to a filesystem walk', () => {
    const dir = tree({ 'top.ts': 'export const a = 1;\n', 'nested/deep.ts': 'export const b = 2;\n', 'notes.md': '# title\n' });
    expect(trackedSources(dir)).toEqual([]);
    expect(sources(dir).sort()).toEqual([join(dir, 'nested/deep.ts'), join(dir, 'top.ts')]);
});
