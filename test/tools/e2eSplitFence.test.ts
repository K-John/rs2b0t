import { describe, expect, test } from 'bun:test';
import { relative } from 'node:path';
import {
    bunTestNamesUnder,
    importsInto,
    liveClosure,
    misnamedUnder,
    readTree,
    walk
} from '../../tools/audit-e2e-split.js';

const paths = (dir: string): string[] => walk(dir).map(p => relative(process.cwd(), p));

describe('e2e/tools split', () => {
    test('no file under tools/ imports across into e2e/', () => {
        expect(importsInto('tools', 'e2e', readTree('tools'))).toEqual([]);
    });

    test('no file under tools/ reaches the harness ABI from inside tools/', () => {
        expect(liveClosure('e2e/lib/harness.ts', readTree('tools')).move).toEqual([]);
    });

    test('no harness-suffixed file is left in tools/', () => {
        expect(misnamedUnder('tools', paths('tools'))).toEqual([]);
    });

    test('no file under e2e/ is auto-discovered by bun test', () => {
        expect(bunTestNamesUnder('e2e', paths('e2e'))).toEqual([]);
    });

    test('the harness fleet is non-empty', () => {
        const harnesses = paths('e2e').filter(f => f.endsWith('-test.ts') || f.endsWith('-live.ts'));
        expect(harnesses.length).toBeGreaterThan(50);
    });
});
