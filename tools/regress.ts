/**
 * Nightly regression runner.
 *
 * Deploys once, runs the offline gates and then the live harnesses sequentially,
 * and writes a report that diffs against the previous run — so the output names
 * what CHANGED rather than what is merely red.
 *
 * Usage:
 *   bun run regress                    # quick tier
 *   bun run regress -- --tier standard
 *   bun run regress -- --tier quests --engine ~/code/rs2b2t-engine
 *   bun run regress -- --only troll,horror
 *   bun run regress -- --gates-only    # offline only, no engine needed
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Status = 'pass' | 'fail' | 'timeout' | 'skip';
type Tier = 'quick' | 'standard' | 'quests';
interface Result { name: string; kind: 'gate' | 'harness'; status: Status; ms: number; note: string; }
interface Run { startedAt: string; git: string; tier: Tier; results: Result[]; }

const OUT = 'out/regress';
const LOGS = join(OUT, 'logs');
const LATEST = join(OUT, 'latest.json');

/** Harnesses that need a world, an account or a second machine no runner can provide. */
const EXCLUDED = new Set(['hosted-proof-test.ts', 'hosted-wall-test.ts', 'external-script-test.ts']);

/** Minutes per harness. Anything absent gets DEFAULT_BUDGET. */
const BUDGET: Record<string, number> = {
    'trollstronghold-264-live.ts': 90,
    'horror-deep-216-live.ts': 90,
    'family-crest-210-live.ts': 75,
    'knights-sword-228-live.ts': 60,
    'ernest-chicken-229-live.ts': 45,
    'aio-quest-test.ts': 120
};
const DEFAULT_BUDGET = 12;

/**
 * `verdict` overrides the exit code where a tool's status is in its output.
 * The generators print STALE and then some exit non-zero on an unrelated
 * teardown crash in the vendored audio shim, so exit code alone reports a clean
 * generator as a regression.
 */
const DRIFT = (text: string): Status => (/\bSTALE\b|does not match/i.test(text) ? 'fail' : 'pass');

interface Gate { name: string; cmd: string[]; verdict?: (text: string) => Status; }
const OFFLINE_GATES: Gate[] = [
    { name: 'unit tests', cmd: ['bun', 'test'] },
    { name: 'typecheck', cmd: ['bun', 'run', 'typecheck'] },
    { name: 'lint', cmd: ['bun', 'run', 'lint'] },
    { name: 'cluedb drift', cmd: ['bun', 'tools/clues/gen-cluedb.ts', '--check'], verdict: DRIFT },
    { name: 'dropdb drift', cmd: ['bun', 'tools/combat/gen-dropdb.ts', '--check'], verdict: DRIFT },
    { name: 'spelldb drift', cmd: ['bun', 'tools/combat/gen-spelldb.ts', '--check'], verdict: DRIFT },
    { name: 'itemdb drift', cmd: ['bun', 'tools/items/gen-itemdb.ts', '--check'], verdict: DRIFT },
    { name: 'shopdb drift', cmd: ['bun', 'tools/shops/gen-shopdb.ts', '--check'], verdict: DRIFT },
    { name: 'scriptdocs drift', cmd: ['bun', 'tools/gen-scriptdocs.ts', '--check'], verdict: DRIFT }
];

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** A harness is a quest run when it takes --stage; those cost tens of minutes each. */
function tierOf(file: string): Tier {
    const src = readFileSync(join('tools', file), 'utf8');
    if (src.includes("'--stage'")) return 'quests';
    return file.endsWith('-live.ts') ? 'standard' : 'quick';
}

function harnesses(tier: Tier, only: string[]): string[] {
    const wanted: Tier[] = tier === 'quick' ? ['quick'] : tier === 'standard' ? ['quick', 'standard'] : ['quick', 'standard', 'quests'];
    return readdirSync('tools')
        .filter(f => (f.endsWith('-test.ts') || f.endsWith('-live.ts')) && !EXCLUDED.has(f))
        .filter(f => wanted.includes(tierOf(f)))
        .filter(f => only.length === 0 || only.some(o => f.includes(o)))
        .sort();
}

async function run(cmd: string[], logFile: string, budgetMs: number, verdict?: (text: string) => Status): Promise<{ status: Status; ms: number; tail: string }> {
    const started = Date.now();
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HEADED: '0' } });
    const timer = setTimeout(() => proc.kill(9), budgetMs);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    const ms = Date.now() - started;
    const text = out + err;
    writeFileSync(logFile, text);
    const timedOut = ms >= budgetMs - 1000;
    const tail = text.trim().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 240);
    const status: Status = timedOut ? 'timeout' : verdict ? verdict(text) : code === 0 ? 'pass' : 'fail';
    return { status, ms, tail };
}

const mins = (ms: number): string => `${(ms / 60000).toFixed(1)}m`;
const ICON: Record<Status, string> = { pass: '✅', fail: '❌', timeout: '⏱', skip: '⏭' };

function report(now: Run, before: Run | null): string {
    const prev = new Map((before?.results ?? []).map(r => [r.name, r.status]));
    const newlyBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) === 'pass');
    const newlyFixed = now.results.filter(r => r.status === 'pass' && prev.has(r.name) && prev.get(r.name) !== 'pass');
    const stillBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) && prev.get(r.name) !== 'pass');
    const untracked = now.results.filter(r => r.status !== 'pass' && !prev.has(r.name));

    const rows = (rs: Result[]): string => rs.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} | ${r.note} |`).join('\n');
    const section = (title: string, rs: Result[], empty: string): string =>
        rs.length === 0 ? `## ${title}\n\n${empty}\n` : `## ${title}\n\n| Item | Status | Time | Last output |\n|---|---|---|---|\n${rows(rs)}\n`;

    const failed = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
    const head = [
        '# Regression report',
        '',
        '| | |',
        '|---|---|',
        `| Started | ${now.startedAt} |`,
        `| Commit | \`${now.git}\` |`,
        `| Tier | ${now.tier} |`,
        `| Ran | ${now.results.length} |`,
        `| Failing | ${failed} |`,
        `| Baseline | ${before ? `${before.startedAt} (\`${before.git}\`)` : 'none — this is the first run'} |`,
        ''
    ].join('\n');

    return [
        head,
        section('Newly broken since the baseline', newlyBroken, 'Nothing regressed.'),
        section('Newly fixed', newlyFixed, 'Nothing newly fixed.'),
        section('Still broken', stillBroken, 'Nothing carried over.'),
        section('Failing, no baseline entry', untracked, 'Nothing new and failing.'),
        '## Everything\n\n| Item | Status | Time |\n|---|---|---|\n' +
            now.results.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} |`).join('\n') + '\n',
        `Logs: \`${LOGS}/\`\n`
    ].join('\n');
}

const tier = (arg('tier') as Tier | undefined) ?? 'quick';
const only = (arg('only') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const engine = arg('engine');

mkdirSync(LOGS, { recursive: true });
const git = (await new Response(Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe' }).stdout).text()).trim();
const now: Run = { startedAt: new Date().toISOString(), git, tier, results: [] };

console.log(`regress: tier=${tier} commit=${git}`);

for (const { name, cmd, verdict } of OFFLINE_GATES) {
    const r = await run(cmd, join(LOGS, `${name.replace(/\W+/g, '-')}.log`), 20 * 60_000, verdict);
    now.results.push({ name, kind: 'gate', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
    console.log(`  ${ICON[r.status]} ${name} (${mins(r.ms)})`);
}

if (!has('gates-only')) {
    const gatesGreen = now.results.every(r => r.status === 'pass');
    if (!gatesGreen && !has('force')) {
        console.log('offline gates failed — skipping harnesses (pass --force to run anyway)');
    } else {
        const deploy = await run(['sh', 'tools/deploy-local.sh'], join(LOGS, 'deploy.log'), 20 * 60_000);
        now.results.push({ name: 'deploy', kind: 'gate', status: deploy.status, ms: deploy.ms, note: deploy.status === 'pass' ? '' : deploy.tail });
        console.log(`  ${ICON[deploy.status]} deploy (${mins(deploy.ms)})`);

        if (deploy.status === 'pass') {
            for (const file of harnesses(tier, only)) {
                const budget = (BUDGET[file] ?? DEFAULT_BUDGET) * 60_000;
                const cmd = ['bun', join('tools', file), '--no-deploy'];
                if (engine) cmd.push('--base', engine);
                const r = await run(cmd, join(LOGS, `${file}.log`), budget);
                now.results.push({ name: file, kind: 'harness', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
                console.log(`  ${ICON[r.status]} ${file} (${mins(r.ms)})`);
            }
        } else {
            console.log('deploy failed — harnesses would test a stale bundle, so none were run');
        }
    }
}

const before: Run | null = existsSync(LATEST) ? JSON.parse(readFileSync(LATEST, 'utf8')) as Run : null;
const md = report(now, before);
const stamp = now.startedAt.replace(/[:.]/g, '-');
writeFileSync(join(OUT, `${stamp}.json`), JSON.stringify(now, null, 1));
writeFileSync(join(OUT, 'report.md'), md);
writeFileSync(LATEST, JSON.stringify(now, null, 1));

console.log(`\n${md.split('## Everything')[0]}`);
console.log(`report: ${OUT}/report.md`);

const broken = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
process.exit(broken > 0 ? 1 : 0);
