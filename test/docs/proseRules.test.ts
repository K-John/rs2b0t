import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

const VALE = 'node_modules/@vvago/vale/bin/vale';
const FIXTURES = 'styles/RS2B0T/fixtures';

export type Alert = { Check: string; Severity: string; Line: number; Match: string; Message: string };

export function lint(paths: string[]): Map<string, Alert[]> {
    const run = spawnSync(VALE, ['--config=.vale.ini', '--output=JSON', '--no-exit', ...paths], { encoding: 'utf8' });
    if (run.error) throw new Error(`vale did not run: ${run.error.message}`);
    const report = JSON.parse(run.stdout || '{}') as Record<string, Alert[]>;
    const byPath = new Map<string, Alert[]>();
    const cwd = `${process.cwd()}/`;
    for (const [path, alerts] of Object.entries(report)) {
        byPath.set(path.startsWith(cwd) ? path.slice(cwd.length) : path, alerts);
    }
    return byPath;
}

function alertsFor(file: string): Alert[] {
    return lint([`${FIXTURES}/${file}`]).get(`${FIXTURES}/${file}`) ?? [];
}

function checksIn(file: string): Set<string> {
    return new Set(alertsFor(file).map(a => a.Check));
}

test('BannedWords fires on markdown', () => {
    expect(checksIn('probe.md').has('RS2B0T.BannedWords')).toBe(true);
});

test('BannedWords fires inside a TypeScript comment', () => {
    expect(checksIn('probe.ts').has('RS2B0T.BannedWords')).toBe(true);
});

test('BannedWords ignores a TypeScript string literal', () => {
    expect(alertsFor('probe.ts').filter(a => a.Match === 'notacomment')).toEqual([]);
});

const BOTH_FORMATS = ['RS2B0T.SoftWords', 'RS2B0T.Wordiness', 'RS2B0T.Editorialising', 'RS2B0T.Antithesis'];

test.each(BOTH_FORMATS)('%s fires on markdown', check => {
    expect(checksIn('probe.md').has(check)).toBe(true);
});

test.each(BOTH_FORMATS)('%s fires inside a TypeScript comment', check => {
    expect(checksIn('probe.ts').has(check)).toBe(true);
});

test('SoftWords is a warning, so it never gates', () => {
    const soft = alertsFor('probe.md').filter(a => a.Check === 'RS2B0T.SoftWords');
    expect(soft.length).toBeGreaterThan(0);
    expect(soft.every(a => a.Severity === 'warning')).toBe(true);
});
