import { readFileSync } from 'node:fs';

export type Finding = { file: string; line: number; check: string; message: string };

const DOC_CAP = 150;

function isGenerated(body: string): boolean {
    return body.slice(0, 400).includes('<!-- GENERATED');
}

export function checkDocCap(files: string[]): Finding[] {
    const found: Finding[] = [];
    for (const file of files) {
        const body = readFileSync(file, 'utf8');
        if (isGenerated(body)) continue;
        const lines = body.split('\n');
        const count = lines.at(-1) === '' ? lines.length - 1 : lines.length;
        if (count > DOC_CAP) {
            found.push({ file, line: DOC_CAP + 1, check: 'doc-cap', message: `${count} lines exceeds the ${DOC_CAP}-line cap; split the file rather than compressing it.` });
        }
    }
    return found;
}
