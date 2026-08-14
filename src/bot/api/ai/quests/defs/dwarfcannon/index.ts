import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { CAVE_HOPS, COMMANDER, FALADOR_WEST_BANK, MC_FOOD_TARGET, MC_OBJ, NULODION } from './areas.js';
import { MC_FLAG, MC_STAGE, readDwarfCannonProgress } from './journal.js';
import { fixRailings } from './repair.js';

export { MCANNON_QUEST, MC_FLAG, MC_STAGE, parseDwarfCannonJournal, readDwarfCannonProgress } from './journal.js';
export { CANNON_PARTS, MC_OBJ, MC_TILE, RAILINGS } from './areas.js';

const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;

const todo = (what: string): QuestStep => ({ kind: 'wait', reason: `not implemented yet: ${what}` });

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep => ({
    kind: 'custom',
    name,
    run
});

export function decide(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage ?? snap.stage;
    if (snap.journal === 'complete' || (stage ?? 0) >= MC_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Dwarf Cannon journal stage unavailable' };
    }

    if (stage === MC_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: COMMANDER };
    }
    if (stage === MC_STAGE.RAILINGS) {
        return hasFlag(snap.progress, MC_FLAG.RAILINGS_DONE)
            ? { kind: 'talk', stop: COMMANDER }
            : custom('replace the six broken railings', fixRailings);
    }
    if (stage === MC_STAGE.GUARD_TOWER) {
        return heldId(snap, MC_OBJ.REMAINS.id) > 0
            ? { kind: 'talk', stop: COMMANDER }
            : todo('the watchtower climb');
    }
    if (stage === MC_STAGE.GOBLIN_CAVE || stage === MC_STAGE.FIND_CHILD) {
        return todo('the goblin cave');
    }
    if (stage === MC_STAGE.CHILD_RESCUED) {
        return { kind: 'talk', stop: COMMANDER };
    }
    if (stage === MC_STAGE.FIX_CANNON) {
        return todo('the cannon repair loop');
    }
    if (stage === MC_STAGE.CANNON_FIXED) {
        return { kind: 'talk', stop: COMMANDER };
    }
    if (stage === MC_STAGE.SEE_NULODION) {
        return { kind: 'talk', stop: NULODION };
    }
    if (stage === MC_STAGE.RETURN_NOTES) {
        // Why: Nulodion re-issues whichever of the two is missing, and the Commander refuses the hand-over without both.
        const complete = heldId(snap, MC_OBJ.NOTES.id) > 0 && heldId(snap, MC_OBJ.MOULD.id) > 0;
        return { kind: 'talk', stop: complete ? COMMANDER : NULODION };
    }
    return { kind: 'wait', reason: `unrecognized Dwarf Cannon stage ${stage}` };
}

function warnDwarfCannonReadiness(): string | null {
    const bits: string[] = [];
    if (Skills.level('crafting') < 40 && Skills.level('smithing') < 40) {
        bits.push('every railing and cannon part is a Crafting/Smithing roll — below 40 in both, expect repeated failures and self-damage');
    }
    if (Skills.level('hitpoints') < 30) {
        bits.push(`the goblin cave is twenty goblins deep (hp=${Skills.level('hitpoints')})`);
    }
    return bits.length > 0 ? `Dwarf Cannon: ${bits.join('; ')}` : null;
}

// Why: `tools` is read at one place in QuestEngine — the spillover keep list — and is never provisioned, so a resume mid-quest does not bank its own state.

export const dwarfcannon: QuestModule = {
    record: QUESTS.find(r => r.id === 'mcannon')!,
    bank: FALADOR_WEST_BANK,
    hops: [...CAVE_HOPS],
    food: MC_FOOD_TARGET,
    tools: ['coins', 'tool kit', 'dwarf remains', "nulodion's notes", 'ammo mould', 'railing'],
    readProgress: readDwarfCannonProgress,
    sustain: { foods: ['Lobster', 'Trout', 'Bread'], eatBelowHp: 0.6 },
    warnReadiness: warnDwarfCannonReadiness,
    decide
};
