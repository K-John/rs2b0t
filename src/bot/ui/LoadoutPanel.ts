import { Loadouts } from '../items/loadoutStore.js';
import { removeLoadout, uniqueName, upsertLoadout, type Loadout } from '../items/loadouts.js';
import type { ItemRecord, Slot } from '../items/types.js';
import { el } from './dom.js';
import { itemIconDataUrl } from './itemIcon.js';
import {
    consumableOptions,
    searchItems,
    shieldDisabled,
    slotOptions,
    SLOT_LAYOUT,
    SUPPLY_ROWS,
    wearItem,
    type SupplyRow
} from './loadoutPanelLogic.js';

/** What the picker is currently choosing for. */
type Target = { kind: 'slot'; slot: Slot } | { kind: 'supply'; row: SupplyRow };

const SLOT_LABEL: Record<Slot, string> = {
    hat: 'Head',
    back: 'Cape',
    front: 'Amulet',
    righthand: 'Weapon',
    torso: 'Body',
    lefthand: 'Shield',
    legs: 'Legs',
    hands: 'Gloves',
    feet: 'Boots',
    ring: 'Ring',
    quiver: 'Ammo'
};

/**
 * Editor for the player's named loadouts.
 *
 * Every mutation goes through the store and re-renders, so there is no
 * in-memory copy that can drift from what is saved.
 */
export class LoadoutPanel {
    readonly root = el('div', 'rs2b0t-loadout-panel');

    constructor() {
        this.root.style.display = 'none';
    }

    private selected: string | null = null;
    private picker: Target | null = null;
    private query = '';
    /** Supply row label → the item that row holds. See {@link supplyRow}. */
    private readonly supplyItem = new Map<string, string>();

    open(): void {
        this.root.style.display = '';
        const names = Loadouts.names();
        if (this.selected === null || !names.includes(this.selected)) {
            this.selected = names[0] ?? null;
        }
        this.adoptCarry();
        this.render();
    }

    close(): void {
        this.root.style.display = 'none';
        this.picker = null;
    }

    /**
     * Give each saved carry entry a row to live on, so a reopened panel shows
     * what was saved. Entries past the six named rows are left unclaimed.
     */
    private adoptCarry(): void {
        const loadout = this.current();
        if (!loadout) {
            return;
        }
        const claimed = new Set(this.supplyItem.values());
        const free = SUPPLY_ROWS.filter(r => !this.supplyItem.has(r.label));
        for (const entry of loadout.carry) {
            if (claimed.has(entry.item)) {
                continue;
            }
            const row = free.shift();
            if (!row) {
                return;
            }
            this.supplyItem.set(row.label, entry.item);
            claimed.add(entry.item);
        }
    }

    private current(): Loadout | null {
        return this.selected === null ? null : Loadouts.byName(this.selected);
    }

    private commit(next: Loadout): void {
        Loadouts.save(upsertLoadout(Loadouts.all(), next));
        this.selected = next.name;
        this.render();
    }

    private render(): void {
        this.root.replaceChildren();
        this.root.appendChild(this.header());
        const body = el('div', 'rs2b0t-loadout-body');
        body.appendChild(this.equipmentGrid());
        body.appendChild(this.supplies());
        this.root.appendChild(body);
        if (this.picker) {
            this.root.appendChild(this.pickerList(this.picker));
        }
    }

    private header(): HTMLElement {
        const bar = el('div', 'rs2b0t-loadout-header');
        const list = Loadouts.all();

        const select = el('select', 'rs2b0t-select');
        for (const l of list) {
            const opt = document.createElement('option');
            opt.value = l.name;
            opt.textContent = l.name;
            opt.selected = l.name === this.selected;
            select.appendChild(opt);
        }
        select.addEventListener('change', () => {
            this.selected = select.value;
            this.picker = null;
            this.render();
        });
        bar.appendChild(select);

        bar.appendChild(this.action('new', '+ new', () => {
            const created: Loadout = { name: uniqueName(Loadouts.all(), 'loadout'), worn: {}, carry: [] };
            this.commit(created);
        }));
        bar.appendChild(this.action('rename', 'rename', () => {
            const from = this.current();
            if (!from) {
                return;
            }
            const typed = globalThis.prompt?.('Loadout name', from.name)?.trim();
            if (!typed || typed.toLowerCase() === from.name.toLowerCase()) {
                return;
            }
            const without = removeLoadout(Loadouts.all(), from.name);
            Loadouts.save(upsertLoadout(without, { ...from, name: uniqueName(without, typed) }));
            this.selected = typed;
            this.render();
        }));
        bar.appendChild(this.action('duplicate', 'duplicate', () => {
            const from = this.current();
            if (!from) {
                return;
            }
            this.commit({ ...from, name: uniqueName(Loadouts.all(), from.name) });
        }));
        bar.appendChild(this.action('delete', 'delete', () => {
            if (this.selected === null) {
                return;
            }
            Loadouts.save(removeLoadout(Loadouts.all(), this.selected));
            this.selected = Loadouts.names()[0] ?? null;
            this.picker = null;
            this.render();
        }));
        return bar;
    }

    private action(name: string, label: string, onClick: () => void): HTMLButtonElement {
        const btn = el('button', 'rs2b0t-button');
        btn.dataset.action = name;
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }

    private equipmentGrid(): HTMLElement {
        const grid = el('div', 'rs2b0t-loadout-grid');
        const loadout = this.current();
        const worn = loadout?.worn ?? {};
        const noShield = shieldDisabled(worn);
        for (const row of SLOT_LAYOUT) {
            const line = el('div', 'rs2b0t-loadout-row');
            for (const slot of row) {
                line.appendChild(slot === null ? el('div', 'rs2b0t-loadout-spacer') : this.slotCell(slot, worn[slot], noShield));
            }
            grid.appendChild(line);
        }
        return grid;
    }

    private slotCell(slot: Slot, itemName: string | undefined, noShield: boolean): HTMLElement {
        const cell = el('div', 'rs2b0t-loadout-slot');
        cell.dataset.slot = slot;
        cell.title = SLOT_LABEL[slot];
        const disabled = slot === 'lefthand' && noShield;
        if (disabled) {
            cell.dataset.disabled = 'true';
        }
        if (itemName) {
            cell.dataset.item = itemName;
            cell.appendChild(this.itemFace(itemName));
        } else {
            cell.textContent = SLOT_LABEL[slot];
        }
        cell.addEventListener('click', () => {
            const loadout = this.current();
            if (!loadout || disabled) {
                return;
            }
            if (itemName) {
                this.commit({ ...loadout, worn: wearItem(loadout.worn, slot, null) });
                return;
            }
            this.picker = { kind: 'slot', slot };
            this.query = '';
            this.render();
        });
        return cell;
    }

    /** Icon when the cache has one, the name when it does not. */
    private itemFace(name: string): HTMLElement {
        const face = el('span', 'rs2b0t-loadout-face');
        const record = [...slotOptionsAll(), ...consumableOptions()].find(r => r.name === name);
        const url = record ? itemIconDataUrl(record.id) : null;
        if (url) {
            const img = el('img', 'rs2b0t-loadout-icon');
            img.src = url;
            img.alt = name;
            face.appendChild(img);
        } else {
            face.textContent = name;
        }
        return face;
    }

    private supplies(): HTMLElement {
        const box = el('div', 'rs2b0t-loadout-supplies');
        const loadout = this.current();
        for (const row of SUPPLY_ROWS) {
            box.appendChild(this.supplyRow(row, loadout));
        }
        return box;
    }

    /**
     * A supply row is keyed on the item it holds, not on a position in `carry`.
     * Position cannot work: `carry` drops empty entries, so setting the second
     * row while the first is empty would renumber it onto the first.
     */
    private supplyRow(row: SupplyRow, loadout: Loadout | null): HTMLElement {
        const line = el('div', 'rs2b0t-loadout-supply');
        line.dataset.supply = row.label;

        const label = el('span', 'rs2b0t-loadout-supply-label');
        label.textContent = row.label;
        line.appendChild(label);

        const item = this.supplyItem.get(row.label) ?? null;
        const entry = item === null ? null : (loadout?.carry.find(e => e.item === item) ?? null);

        const pick = el('button', 'rs2b0t-button');
        pick.dataset.role = 'supply-item';
        pick.textContent = item ?? 'choose…';
        pick.addEventListener('click', () => {
            if (!this.current()) {
                return;
            }
            this.picker = { kind: 'supply', row };
            this.query = row.hint;
            this.render();
        });
        line.appendChild(pick);

        const qty = el('input', 'rs2b0t-loadout-qty');
        qty.type = 'number';
        qty.min = '0';
        qty.value = String(entry?.qty ?? 0);
        qty.addEventListener('change', () => {
            const target = this.current();
            if (!target || item === null) {
                return;
            }
            this.commit({ ...target, carry: setCarry(target.carry, item, Number(qty.value)) });
        });
        line.appendChild(qty);
        return line;
    }

    private pickerList(target: Target): HTMLElement {
        const box = el('div', 'rs2b0t-loadout-picker');

        const search = el('input', 'rs2b0t-input');
        search.type = 'text';
        search.dataset.role = 'item-search';
        search.placeholder = 'search…';
        search.value = this.query;
        search.addEventListener('input', () => {
            this.query = search.value;
            this.render();
            (this.root.querySelector('[data-role=item-search]') as HTMLInputElement | null)?.focus();
        });
        box.appendChild(search);

        const options = target.kind === 'slot' ? slotOptions(target.slot) : consumableOptions();
        const results = el('div', 'rs2b0t-loadout-results');
        for (const record of searchItems(options, this.query).slice(0, 200)) {
            results.appendChild(this.pickerRow(record, target));
        }
        box.appendChild(results);
        return box;
    }

    private pickerRow(record: ItemRecord, target: Target): HTMLElement {
        const row = el('div', 'rs2b0t-loadout-result');
        row.dataset.item = record.name;
        const url = itemIconDataUrl(record.id);
        if (url) {
            const img = el('img', 'rs2b0t-loadout-icon');
            img.src = url;
            img.alt = record.name;
            row.appendChild(img);
        }
        const name = el('span', 'rs2b0t-loadout-result-name');
        name.textContent = record.name;
        row.appendChild(name);
        row.addEventListener('click', () => {
            const loadout = this.current();
            if (!loadout) {
                return;
            }
            this.picker = null;
            if (target.kind === 'slot') {
                this.commit({ ...loadout, worn: wearItem(loadout.worn, target.slot, record.name) });
                return;
            }
            const previous = this.supplyItem.get(target.row.label);
            this.supplyItem.set(target.row.label, record.name);
            const kept = previous === undefined ? loadout.carry : loadout.carry.filter(e => e.item !== previous);
            const existing = kept.find(e => e.item === record.name);
            this.commit({ ...loadout, carry: setCarry(kept, record.name, existing?.qty ?? 1) });
        });
        return row;
    }
}

/** Every wearable record, for resolving a stored name back to its icon. */
function slotOptionsAll(): ItemRecord[] {
    return SLOT_LAYOUT.flat()
        .filter((s): s is Slot => s !== null)
        .flatMap(slot => slotOptions(slot));
}

/** Set one item's quantity. Zero removes it. */
function setCarry(
    carry: readonly { item: string; qty: number }[],
    item: string,
    qty: number
): { item: string; qty: number }[] {
    const wanted = Math.max(0, Math.floor(qty));
    const without = carry.filter(e => e.item !== item);
    return wanted > 0 ? [...without, { item, qty: wanted }] : without;
}
