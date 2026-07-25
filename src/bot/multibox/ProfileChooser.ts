import { listProfiles, removeProfile, upsertProfile, type Profile } from '../runtime/Profiles.js';

export class ProfileChooser {
    readonly el: HTMLDivElement;

    private list: HTMLDivElement;
    private user: HTMLInputElement;
    private pass: HTMLInputElement;

    constructor(private onLoad: (p: Profile) => void) {
        this.el = document.createElement('div');
        this.el.className = 'mbx-chooser-overlay';
        this.el.hidden = true;
        this.el.addEventListener('click', ev => {
            if (ev.target === this.el) {
                this.close();
            }
        });

        const box = document.createElement('div');
        box.className = 'mbx-chooser';

        const title = document.createElement('div');
        title.className = 'mbx-chooser-title';
        title.textContent = 'saved profiles';

        this.list = document.createElement('div');
        this.list.className = 'mbx-chooser-list';

        const form = document.createElement('form');
        form.className = 'mbx-chooser-form';
        this.user = document.createElement('input');
        this.user.id = 'mbx-new-user';
        this.user.placeholder = 'username';
        this.pass = document.createElement('input');
        this.pass.id = 'mbx-new-pass';
        this.pass.type = 'password';
        this.pass.placeholder = 'password';
        const go = document.createElement('button');
        go.id = 'mbx-new-go';
        go.type = 'submit';
        go.textContent = 'create + load';
        form.append(this.user, this.pass, go);
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            const username = this.user.value.trim();
            if (username.length === 0) {
                return;
            }
            const p = { username, password: this.pass.value };
            upsertProfile(p);
            this.user.value = '';
            this.pass.value = '';
            this.close();
            this.onLoad(p);
        });

        box.append(title, this.list, form);
        this.el.appendChild(box);
    }

    open(): void {
        this.render();
        this.el.hidden = false;
        this.user.focus();
    }

    close(): void {
        this.el.hidden = true;
    }

    private render(): void {
        this.list.textContent = '';
        const profiles = listProfiles();
        if (profiles.length === 0) {
            const none = document.createElement('div');
            none.className = 'mbx-chooser-empty';
            none.textContent = 'no saved profiles yet';
            this.list.appendChild(none);
            return;
        }
        for (const p of profiles) {
            const row = document.createElement('div');
            row.className = 'mbx-profile-row';
            const name = document.createElement('span');
            name.className = 'mbx-profile-name';
            name.textContent = p.username;
            const del = document.createElement('button');
            del.className = 'mbx-profile-del';
            del.type = 'button';
            del.textContent = '✕';
            del.addEventListener('click', ev => {
                ev.stopPropagation();
                removeProfile(p.username);
                this.render();
            });
            row.append(name, del);
            row.addEventListener('click', () => {
                this.close();
                this.onLoad(p);
            });
            this.list.appendChild(row);
        }
    }
}
