import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Skills } from '../../api/hud/Skills.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import { QuestFood } from '../food.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const BARTENDER: NpcStop = { npc: 'Bartender', anchor: new Tile(3045, 3257, 0), leash: 8, prefer: ['Not very busy in here today, is it?'] };

const GENERAL: NpcStop = { npc: 'General Wartface', anchor: new Tile(2957, 3510, 0), leash: 6, prefer: ['Do you want me to pick an armour colour for you?'] };

const AGGIE_ANCHOR = new Tile(3086, 3259, 0);
const AGGIE_RED: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make red dye?', 'Okay, make me some red dye please.'] };
const AGGIE_YELLOW: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make yellow dye?', 'Okay, make me some yellow dye please.'] };
const AGGIE_BLUE: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make blue dye?', 'Okay, make me some blue dye please.'] };

const WYSON: NpcStop = { npc: 'Wyson the gardener', anchor: new Tile(3013, 3377, 0), leash: 10, prefer: ["I'm looking for woad leaves.", 'How about 20 coins?'] };

const GOBLIN_FARM = new Tile(2958, 3507, 0);
const ONION_PATCH = new Tile(3188, 3267, 0);
const PORT_SARIM_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
const DRAYNOR_BANK = new Tile(3093, 3243, 0);
/** South of the village, clear of the goblins' aggression range. */
const RETREAT = new Tile(2967, 3486, 0);

const BANK_FOODS = [
    'Shark',
    'Lobster',
    'Swordfish',
    'Tuna',
    'Salmon',
    'Trout',
    'Bread',
    'Cooked meat',
    'Cooked chicken',
    'Cake',
    'Cheese',
    'Banana'
] as const;

/** Wydin is already on the dye run, and sells the only food near the route. */
const SHOP_FOOD = { name: 'Cheese', cost: 12 };
const FOOD_TARGET = 12;
/**
 * The village is a long walk from Draynor, so only restock when nearly out.
 * Topping up to the target after every bite trades the whole grind for the road.
 */
const FOOD_RESTOCK_AT = 2;
/** Break off and eat rather than trade the last hits for one more mail. */
const RETREAT_HP = 0.4;

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const qty = (snap: QuestSnapshot, name: string): number => snap.inv.get(name) ?? 0;
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;

function foodNames(): string[] {
    const configured = QuestFood.name?.trim();
    const names = [configured, ...BANK_FOODS].filter((name): name is string => Boolean(name));
    return [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
}

function foodHeld(snap: QuestSnapshot): number {
    return foodNames().reduce((total, name) => total + qty(snap, name.toLowerCase()), 0);
}

function packFood(): number {
    return foodNames().reduce((total, name) => total + Inventory.count(name), 0);
}

/** Stock up before the grind: bank first, then buy what Wydin carries. */
function sourceFood(snap: QuestSnapshot): QuestStep | null {
    const have = foodHeld(snap);
    if (have > FOOD_RESTOCK_AT) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: DRAYNOR_BANK };
    }
    for (const name of foodNames()) {
        const available = banked(snap, name);
        if (available > 0) {
            return { kind: 'withdraw', items: [{ name, qty: Math.min(FOOD_TARGET - have, available) }], bank: DRAYNOR_BANK };
        }
    }
    const missing = FOOD_TARGET - have;
    const cost = missing * SHOP_FOOD.cost;
    if (qty(snap, 'coins') + snap.bankCoins >= cost) {
        return { kind: 'buy', item: SHOP_FOOD.name, qty: missing, shop: PORT_SARIM_SHOP, estGp: cost };
    }
    return null;
}

async function farmGoblinMail(log: (m: string) => void): Promise<boolean> {
    const drop = GroundItems.query().name('Goblin mail').within(15).nearest();
    if (drop) {
        const before = Inventory.count('Goblin mail');
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.count('Goblin mail') > before, 6000);
    }
    if (Skills.hpFraction() < RETREAT_HP && packFood() === 0) {
        log('out of food and hurt — leaving the goblins alone');
        await Traversal.walkResilient(RETREAT, { radius: 3, attempts: 2, timeoutMs: 90_000, log });
        return false;
    }
    if (Game.inCombat()) {
        await Execution.delayTicks(2);
        return false;
    }
    const goblin = Npcs.query().name('Goblin').action('Attack').within(15)
        .where(n => !n.inCombat && !n.targetsAnotherPlayer()).nearest();
    if (goblin) {
        if (!(await goblin.interact('Attack'))) {
            return false;
        }
        await Execution.delayUntil(() => Game.inCombat() || !goblin.valid(), 4000);
        return false;
    }
    await Traversal.walkResilient(GOBLIN_FARM, { radius: 4, attempts: 2, timeoutMs: 90_000, log });
    return false;
}

function gatherGoblinMail(snap: QuestSnapshot): QuestStep {
    return sourceFood(snap) ?? { kind: 'custom', name: 'farm goblin mail', run: farmGoblinMail };
}

async function makeBlueDye(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Blue dye')) {
        return true;
    }
    if (Inventory.count('Woad leaf') < 2) {
        if (Inventory.count('Coins') < 20) {
            log('need ~20 coins for woad leaves');
            return false;
        }
        if (!(await gotoNpc(WYSON, [], log))) {
            return false;
        }
        await talkThrough(WYSON.npc, WYSON.prefer, log);
        return false;
    }
    if (Inventory.count('Coins') < 5) {
        log('need ~5 coins for blue dye');
        return false;
    }
    if (!(await gotoNpc(AGGIE_BLUE, [], log))) {
        return false;
    }
    await talkThrough(AGGIE_BLUE.npc, AGGIE_BLUE.prefer, log);
    return Execution.delayUntil(() => Inventory.contains('Blue dye'), 8000);
}

async function makeOrangeDye(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Orange dye')) {
        return true;
    }
    if (!Inventory.contains('Red dye')) {
        if (Inventory.count('Redberries') < 3) {
            return executeStep({ kind: 'buy', item: 'Redberries', qty: 3, shop: PORT_SARIM_SHOP, estGp: 60 }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for red dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_RED, [], log))) {
            return false;
        }
        await talkThrough(AGGIE_RED.npc, AGGIE_RED.prefer, log);
        return false;
    }
    if (!Inventory.contains('Yellow dye')) {
        if (Inventory.count('Onion') < 2) {
            return executeStep({ kind: 'pickLoc', loc: 'Onion', op: 'Pick', item: 'Onion', anchor: ONION_PATCH }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for yellow dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_YELLOW, [], log))) {
            return false;
        }
        await talkThrough(AGGIE_YELLOW.npc, AGGIE_YELLOW.prefer, log);
        return false;
    }
    return executeStep({ kind: 'useOn', item: 'Red dye', targetKind: 'item', target: 'Yellow dye', anchor: AGGIE_ANCHOR, product: 'Orange dye' }, [], log);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: BARTENDER }; }

    const plainMail = qty(snap, 'goblin mail');
    const orangeMail = has(snap, 'orange goblin mail');
    const blueMail = has(snap, 'blue goblin mail');

    if (has(snap, 'orange dye') && !orangeMail && plainMail >= 1) {
        return { kind: 'useOn', item: 'Orange dye', targetKind: 'item', target: 'Goblin mail', anchor: GENERAL.anchor, product: 'Orange goblin mail' };
    }
    if (has(snap, 'blue dye') && !blueMail && plainMail >= 2) {
        return { kind: 'useOn', item: 'Blue dye', targetKind: 'item', target: 'Goblin mail', anchor: GENERAL.anchor, product: 'Blue goblin mail' };
    }

    return { kind: 'talk', stop: GENERAL };
}

export const goblindiplomacy: QuestModule = {
    record: QUESTS.find(r => r.id === 'gobdip')!,
    bank: DRAYNOR_BANK,
    tools: ['goblin mail', 'dye', 'woad', 'redberries', 'onion', 'coins', ...foodNames().map(n => n.toLowerCase())],
    grind: ['Goblin'],
    food: FOOD_TARGET,
    sustain: { foods: foodNames(), eatBelowHp: 0.6 },
    gather: {
        'goblin mail': gatherGoblinMail,
        'orange dye': () => ({ kind: 'custom', name: 'make orange dye', run: makeOrangeDye }),
        'blue dye': () => ({ kind: 'custom', name: 'make blue dye', run: makeBlueDye })
    },
    decide
};
