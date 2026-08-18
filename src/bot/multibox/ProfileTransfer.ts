import type { Profile } from './ProfileVault.js';

export const PROFILE_FILE_KIND = 'rs2b0t-multibox-profiles';
export const PROFILE_FILE_VERSION = 1;
export const PROFILE_FILE_NAME = 'rs2b0t-profiles.json';

export interface ProfileSnapshot {
    profiles: Profile[];
    tabs: string[];
    activeTab: string;
}

export interface ProfileFile extends ProfileSnapshot {
    kind: typeof PROFILE_FILE_KIND;
    v: typeof PROFILE_FILE_VERSION;
}

const MAIN_TAB = 'Main';

export function serializeProfileFile(data: ProfileSnapshot): string {
    const file: ProfileFile = {
        kind: PROFILE_FILE_KIND,
        v: PROFILE_FILE_VERSION,
        profiles: data.profiles,
        tabs: data.tabs,
        activeTab: data.activeTab
    };
    return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseProfileFile(text: string): ProfileSnapshot {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('profile file is not JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('profile file has an unrecognized shape');
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.kind !== PROFILE_FILE_KIND) {
        throw new Error(`profile file kind is ${JSON.stringify(obj.kind)}, expected '${PROFILE_FILE_KIND}'`);
    }
    if (obj.v !== PROFILE_FILE_VERSION) {
        throw new Error(`profile file version is ${JSON.stringify(obj.v)}, expected ${PROFILE_FILE_VERSION}`);
    }
    if (!Array.isArray(obj.profiles) || !Array.isArray(obj.tabs) || typeof obj.activeTab !== 'string') {
        throw new Error('profile file is missing profiles, tabs, or activeTab');
    }
    if (obj.tabs.some(t => typeof t !== 'string')) {
        throw new Error('profile file tabs must be strings');
    }
    return {
        profiles: requireProfiles(obj.profiles),
        tabs: obj.tabs as string[],
        activeTab: obj.activeTab
    };
}

function requireProfiles(v: unknown[]): Profile[] {
    const out: Profile[] = [];
    for (const raw of v) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`invalid profile entry ${JSON.stringify(raw)}`);
        }
        const p = raw as Record<string, unknown>;
        if (typeof p.username !== 'string' || p.username.length === 0 || typeof p.password !== 'string') {
            throw new Error(`invalid profile entry ${JSON.stringify(raw)}`);
        }
        const entry: Profile = { username: p.username, password: p.password };
        if (typeof p.tab === 'string' && p.tab !== MAIN_TAB) {
            entry.tab = p.tab;
        } else if (p.tab !== undefined && p.tab !== MAIN_TAB) {
            throw new Error(`invalid profile tab on '${p.username}': ${JSON.stringify(p.tab)}`);
        }
        out.push(entry);
    }
    return out;
}
