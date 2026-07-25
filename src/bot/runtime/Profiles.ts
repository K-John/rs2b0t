import { boxId } from './box.js';

export interface Profile {
    username: string;
    password: string;
}

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';

const hasLocal = typeof localStorage !== 'undefined';

function parse(raw: string | null): Profile[] | null {
    if (!raw) {
        return null;
    }
    try {
        const v = JSON.parse(raw) as Profile[];
        if (!Array.isArray(v)) {
            return null;
        }
        return v
            .filter(p => typeof p?.username === 'string' && p.username.length > 0 && typeof p?.password === 'string')
            .map(p => ({ username: p.username, password: p.password }));
    } catch {
        return null;
    }
}

function save(profiles: Profile[]): void {
    if (hasLocal) {
        localStorage.setItem(KEY, JSON.stringify(profiles));
    }
}

export function listProfiles(): Profile[] {
    if (!hasLocal) {
        return [];
    }
    const cur = parse(localStorage.getItem(KEY));
    if (cur) {
        return cur;
    }
    // adopt the pre-#30 AccountRoster once
    const legacy = parse(localStorage.getItem(LEGACY_KEY));
    if (legacy) {
        save(legacy);
        return legacy;
    }
    return [];
}

export function upsertProfile(p: Profile): void {
    if (p.username.length === 0) {
        return;
    }
    const all = listProfiles();
    const i = all.findIndex(x => x.username === p.username);
    const entry = { username: p.username, password: p.password };
    if (i >= 0) {
        all[i] = entry;
    } else {
        all.push(entry);
    }
    save(all);
}

export function removeProfile(username: string): void {
    save(listProfiles().filter(x => x.username !== username));
}

export function saveProfileForBox(username: string, password: string, box = boxId()): void {
    if (box === '' || username.length === 0) {
        return;
    }
    upsertProfile({ username, password });
}
