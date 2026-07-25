import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { listProfiles, removeProfile, saveProfileForBox, upsertProfile } from '#/bot/runtime/Profiles.js';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
};
beforeEach(clearAll);
afterEach(clearAll);

describe('Profiles', () => {
    test('empty store lists nothing', () => {
        expect(listProfiles()).toEqual([]);
    });

    test('upsert adds, then updates in place preserving order', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        upsertProfile({ username: 'bob', password: 'b' });
        upsertProfile({ username: 'alice', password: 'a2' });
        expect(listProfiles()).toEqual([
            { username: 'alice', password: 'a2' },
            { username: 'bob', password: 'b' }
        ]);
    });

    test('upsert rejects an empty username', () => {
        upsertProfile({ username: '', password: 'x' });
        expect(listProfiles()).toEqual([]);
    });

    test('remove deletes by username', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        removeProfile('alice');
        expect(listProfiles()).toEqual([]);
    });

    test('adopts the legacy pre-#30 roster when no profiles key exists', () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify([{ username: 'old', password: 'p' }, { username: 7, password: 'x' }]));
        expect(listProfiles()).toEqual([{ username: 'old', password: 'p' }]);
        expect(localStorage.getItem(KEY)).toBe(JSON.stringify([{ username: 'old', password: 'p' }]));
    });

    test('an emptied store does not resurrect the legacy roster', () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify([{ username: 'old', password: 'p' }]));
        expect(listProfiles()).toEqual([{ username: 'old', password: 'p' }]);
        removeProfile('old');
        expect(listProfiles()).toEqual([]);
    });

    test('malformed stored JSON reads as absent', () => {
        localStorage.setItem(KEY, '{nope');
        expect(listProfiles()).toEqual([]);
    });

    test('saveProfileForBox writes only inside a named box', () => {
        saveProfileForBox('alice', 'a', '');
        expect(listProfiles()).toEqual([]);
        saveProfileForBox('', 'pw', 'somebox');
        expect(listProfiles()).toEqual([]);
        saveProfileForBox('alice', 'a', 'alice');
        expect(listProfiles()).toEqual([{ username: 'alice', password: 'a' }]);
    });
});
