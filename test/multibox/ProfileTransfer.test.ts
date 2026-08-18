import { describe, expect, test } from 'bun:test';

import {
    PROFILE_FILE_KIND,
    PROFILE_FILE_VERSION,
    parseProfileFile,
    serializeProfileFile
} from '#/bot/multibox/ProfileTransfer.js';

const snap = {
    profiles: [
        { username: 'alice', password: 'a', tab: 'miners' },
        { username: 'bob', password: 'b' }
    ],
    tabs: ['miners'],
    activeTab: 'miners'
};

describe('ProfileTransfer', () => {
    test('round-trips a vault snapshot', () => {
        const parsed = parseProfileFile(serializeProfileFile(snap));
        expect(parsed).toEqual(snap);
    });

    test('rejects missing kind, wrong version, and garbage', () => {
        expect(() => parseProfileFile('not-json')).toThrow(/not JSON/);
        expect(() => parseProfileFile('[]')).toThrow(/unrecognized shape/);
        expect(() => parseProfileFile(JSON.stringify({ ...snap, v: PROFILE_FILE_VERSION }))).toThrow(/kind/);
        expect(() => parseProfileFile(JSON.stringify({ kind: PROFILE_FILE_KIND, v: 99, ...snap }))).toThrow(/version/);
        expect(() => parseProfileFile(JSON.stringify({ kind: PROFILE_FILE_KIND, v: PROFILE_FILE_VERSION, profiles: [{ username: '' }], tabs: [], activeTab: 'Main' }))).toThrow(/invalid profile/);
    });
});
