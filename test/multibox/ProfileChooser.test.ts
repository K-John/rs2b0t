import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProfileChooser } from '#/bot/multibox/ProfileChooser.js';
import { listProfiles, upsertProfile, type Profile } from '#/bot/runtime/Profiles.js';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '';
};
beforeEach(clearAll);
afterEach(clearAll);

function make(): { chooser: ProfileChooser; loaded: Profile[] } {
    const loaded: Profile[] = [];
    const chooser = new ProfileChooser(p => loaded.push(p));
    document.body.appendChild(chooser.el);
    return { chooser, loaded };
}

describe('ProfileChooser', () => {
    test('starts hidden; open lists saved profiles', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        upsertProfile({ username: 'bob', password: 'b' });
        const { chooser } = make();
        expect(chooser.el.hidden).toBe(true);
        chooser.open();
        expect(chooser.el.hidden).toBe(false);
        const names = Array.from(chooser.el.querySelectorAll('.mbx-profile-name')).map(n => n.textContent);
        expect(names).toEqual(['alice', 'bob']);
    });

    test('clicking a row loads that profile and closes', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('.mbx-profile-row') as HTMLElement).click();
        expect(loaded).toEqual([{ username: 'alice', password: 'a' }]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('the delete button removes the profile without loading it', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('.mbx-profile-del') as HTMLElement).click();
        expect(listProfiles()).toEqual([]);
        expect(loaded).toEqual([]);
        expect(chooser.el.hidden).toBe(false);
        expect(chooser.el.querySelector('.mbx-chooser-empty')).not.toBeNull();
    });

    test('create-new trims, saves and loads the profile', () => {
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('#mbx-new-user') as HTMLInputElement).value = ' carol ';
        (chooser.el.querySelector('#mbx-new-pass') as HTMLInputElement).value = 'pw';
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(listProfiles()).toEqual([{ username: 'carol', password: 'pw' }]);
        expect(loaded).toEqual([{ username: 'carol', password: 'pw' }]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('load all loads every profile and closes', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        upsertProfile({ username: 'bob', password: 'b' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('#mbx-load-all') as HTMLElement).click();
        expect(loaded).toEqual([
            { username: 'alice', password: 'a' },
            { username: 'bob', password: 'b' }
        ]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('load all is absent when no profiles are saved', () => {
        const { chooser } = make();
        chooser.open();
        expect(chooser.el.querySelector('#mbx-load-all')).toBeNull();
    });

    test('create-new with an empty username does nothing', () => {
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(loaded).toEqual([]);
        expect(chooser.el.hidden).toBe(false);
    });
});
