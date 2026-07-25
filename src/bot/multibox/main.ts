import { DomSlotOps } from './DomSlotOps.js';
import { MultiBoxController } from './MultiBoxController.js';
import { ProfileChooser } from './ProfileChooser.js';
import { upsertProfile, type Profile } from '../runtime/Profiles.js';
import type { Account } from './types.js';

function boot(): void {
    const rail = document.getElementById('mbx-rail')!;
    const addTile = document.getElementById('mbx-add')!;

    const ops = new DomSlotOps(rail, addTile);
    const controller = new MultiBoxController(ops);

    // Tiles carry a click-catching overlay (.mbx-hit) because the iframe underneath
    // would otherwise swallow the click and the rail could never switch bots.
    rail.addEventListener('click', ev => {
        const tile = (ev.target as HTMLElement).closest('.mbx-slot');
        if (!tile) return;
        const idx = Array.from(rail.querySelectorAll('.mbx-slot')).indexOf(tile);
        const snap = controller.snapshot()[idx];
        if (snap) { controller.focus(snap.id); renderRail(); }
    });

    const chooser = new ProfileChooser(p => {
        controller.add(p);
        renderRail();
    });
    document.body.appendChild(chooser.el);
    addTile.addEventListener('click', () => chooser.open());

    const app = document.getElementById('mbx-app')!;
    const drawer = document.getElementById('mbx-drawer')!;
    const RAIL_HIDDEN_KEY = 'rs2b0t:multibox:railHidden';
    function setRailHidden(hidden: boolean): void {
        app.classList.toggle('mbx-rail-hidden', hidden);
        drawer.textContent = hidden ? '◀' : '▶';
        localStorage.setItem(RAIL_HIDDEN_KEY, hidden ? '1' : '0');
        // the focused slot re-fits the widened/narrowed main pane via its resize listener
        window.dispatchEvent(new Event('resize'));
    }
    drawer.addEventListener('click', () => setRailHidden(!app.classList.contains('mbx-rail-hidden')));
    if (localStorage.getItem(RAIL_HIDDEN_KEY) === '1') {
        setRailHidden(true);
    }

    // Bind live status (name + online dot) onto the rail tiles, which DomSlotOps
    // keeps in slot order — so snapshot[i] is tile[i].
    function renderRail(): void {
        const snaps = controller.snapshot();
        const tiles = Array.from(rail.querySelectorAll('.mbx-slot'));
        if (tiles.length !== snaps.length) {
            throw new Error(`rail desync: ${tiles.length} tiles vs ${snaps.length} slots`);
        }
        snaps.forEach((s, i) => {
            const tile = tiles[i];
            tile.querySelector('.mbx-dot')!.classList.toggle('is-online', s.ingame);
            tile.querySelector('.mbx-name')!.textContent = s.player ?? s.username;
        });
    }

    window.setInterval(renderRail, 1000);
    renderRail();

    (globalThis as Record<string, unknown>).multibox = {
        controller,
        add: (a?: Account) => controller.add(a),
        focus: (id: number) => { controller.focus(id); renderRail(); },
        slots: () => controller.snapshot(),
        importProfiles: (json: string | Profile[]): number => {
            const arr = typeof json === 'string' ? (JSON.parse(json) as Profile[]) : json;
            let n = 0;
            for (const p of Array.isArray(arr) ? arr : []) {
                if (p && typeof p.username === 'string' && p.username.length > 0 && typeof p.password === 'string') {
                    upsertProfile({ username: p.username, password: p.password });
                    n++;
                }
            }
            return n;
        }
    };
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}
