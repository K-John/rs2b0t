import { describe, expect, test } from 'bun:test';
import {
    bunTestNamesUnder,
    liveClosure,
    misnamedUnder,
    resolveSpec
} from '../../tools/audit-e2e-split.js';

describe('resolveSpec', () => {
    test('resolves a sibling .js specifier to its .ts path', () => {
        expect(resolveSpec('tools/hillgiant-test.ts', './lib/harness.js')).toBe('tools/lib/harness.ts');
    });

    test('resolves a parent-relative specifier', () => {
        expect(resolveSpec('tools/clues/hardclue-e2e.ts', '../lib/harness.js')).toBe('tools/lib/harness.ts');
    });

    test('ignores a bare specifier', () => {
        expect(resolveSpec('tools/x.ts', 'playwright-core')).toBeNull();
    });

    test('ignores an aliased specifier', () => {
        expect(resolveSpec('tools/x.ts', '#/client/io/Packet.js')).toBeNull();
    });
});

describe('liveClosure', () => {
    const entry = 'tools/lib/harness.ts';

    test('moves a direct consumer and the entry itself', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/hillgiant-test.ts', "import { boot } from './lib/harness.js';"],
            ['tools/gen-itemdb.ts', "import { parse } from './items/parse.js';"],
            ['tools/items/parse.ts', '']
        ]);
        expect(liveClosure(entry, sources).move).toEqual(['tools/hillgiant-test.ts', entry]);
    });

    test('moves an ABI leaf imported by a consumer but importing nothing', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/lib/harnessProof.ts', ''],
            ['tools/hillgiant-test.ts', "import { boot } from './lib/harness.js';\nimport { proof } from './lib/harnessProof.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toEqual([
            'tools/hillgiant-test.ts',
            entry,
            'tools/lib/harnessProof.ts'
        ]);
    });

    test('moves a consumer reached transitively', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/tutorial/harness.ts', "import { boot } from '../lib/harness.js';"],
            ['tools/gatheringbot-test.ts', "import { seed } from './tutorial/harness.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toContain('tools/gatheringbot-test.ts');
    });

    test('holds back an ABI module an offline tool also imports', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/nav-script-routes-live.ts', "import { boot } from './lib/harness.js';\nimport { build } from './nav/script-route-corpus.js';"],
            ['tools/nav/script-route-corpus.ts', ''],
            ['tools/nav/mainland-corpus.ts', "import { build } from './script-route-corpus.js';"]
        ]);
        const { move, heldBack } = liveClosure(entry, sources);
        expect(heldBack).toEqual(['tools/nav/script-route-corpus.ts']);
        expect(move).not.toContain('tools/nav/script-route-corpus.ts');
    });

    test('never leaves the source map, so product source is not swept in', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/hillgiant-test.ts', "import { boot } from './lib/harness.js';\nimport { QUESTS } from '../src/bot/api/ai/quests/data/quests.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toEqual(['tools/hillgiant-test.ts', entry]);
    });

    test('reports an empty closure when the entry sits outside the scanned tree', () => {
        const sources = new Map([
            ['tools/gen-itemdb.ts', "import { parse } from './items/parse.js';"],
            ['tools/items/parse.ts', '']
        ]);
        expect(liveClosure('e2e/lib/harness.ts', sources).move).toEqual([]);
    });

    test('survives an import cycle', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/a-live.ts', "import { b } from './b-live.js';\nimport { boot } from './lib/harness.js';"],
            ['tools/b-live.ts', "import { a } from './a-live.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toContain('tools/a-live.ts');
    });

    test('picks up a dynamic import', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/x-live.ts', "const m = await import('./lib/harness.js');"]
        ]);
        expect(liveClosure(entry, sources).move).toContain('tools/x-live.ts');
    });
});

describe('misnamedUnder', () => {
    test('flags harness suffixes under the prefix', () => {
        expect(misnamedUnder('tools', ['tools/a-test.ts', 'tools/b-live.ts', 'tools/gen-x.ts', 'e2e/c-test.ts']))
            .toEqual(['tools/a-test.ts', 'tools/b-live.ts']);
    });
});

describe('bunTestNamesUnder', () => {
    test('flags names bun test would auto-discover', () => {
        expect(bunTestNamesUnder('e2e', ['e2e/a.test.ts', 'e2e/b_test.ts', 'e2e/c.spec.ts', 'e2e/d_spec.ts', 'e2e/e-test.ts']))
            .toEqual(['e2e/a.test.ts', 'e2e/b_test.ts', 'e2e/c.spec.ts', 'e2e/d_spec.ts']);
    });
});
