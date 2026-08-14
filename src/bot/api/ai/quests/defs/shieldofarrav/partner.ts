import { reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Players } from '../../../../players/Players.js';
import { Trade } from '../../../../trade/Trade.js';
import { DEFAULT_TRADE_RANGE, namesMatch } from '../../../../trade/PartnerTrade.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestStep } from '../../engine/types.js';
import { SOA_ID, SOA_TILE } from './areas.js';
import { ArravConfig, type ArravGang } from './config.js';
import { SOA_STAGE } from './journal.js';
import { otherHalf, ownHalf } from './state.js';

export type ArravHandoff =
    | 'give-key' | 'take-key'
    | 'give-half' | 'take-half'
    | 'give-cert' | 'take-cert';

export interface HandoffInput {
    gang: ArravGang;
    stage: number;
    hasKey: boolean;
    hasOwnHalf: boolean;
    hasOtherHalf: boolean;
    certs: number;
    certTarget: number;
    partnerConfigured: boolean;
    /** Whether this session has already handed its shield half over. */
    gaveHalf: boolean;
}

// Why: "I have not farmed my half yet" and "I gave my half away" are the same snapshot — no half, no certificate, joined — and the cupboard re-arms once the half leaves the pack, so nothing durable tells them apart.
// Why: session scope is enough — a restart farms another half, which is correct work rather than a wedge.
export const ArravHandoffState = { gaveHalf: false };

/**
 * Who owes whom. The phoenix bot is the minter by convention: it is the one that
 * can reach Straven and the curator without being given anything first.
 */
export function decideHandoff(input: HandoffInput): ArravHandoff | null {
    if (!input.partnerConfigured) {
        return null;
    }
    const target = Math.max(1, input.certTarget);

    if (input.gang === 'phoenix') {
        // Why: Straven re-issues the key whenever obj_gettotal reads zero, so giving it away costs nothing.
        if (input.stage >= SOA_STAGE.PHOENIX_JOINED && input.stage < SOA_STAGE.COMPLETE && input.hasKey) {
            return 'give-key';
        }
        if (input.hasOwnHalf && input.hasOtherHalf) {
            return null;
        }
        if (input.certs >= 2 && input.certs >= target) {
            return 'give-cert';
        }
        if (input.hasOwnHalf) {
            return 'take-half';
        }
        return null;
    }

    if (input.stage === SOA_STAGE.KATRINE_TASK && !input.hasKey) {
        return 'take-key';
    }
    if (input.hasOwnHalf) {
        return 'give-half';
    }
    // Why: without the flag this fires before the cupboard leg has ever run, and the bot waits for a certificate that only its own half can buy.
    if (input.stage === SOA_STAGE.BLACKARM_JOINED && input.certs === 0 && input.gaveHalf) {
        return 'take-cert';
    }
    return null;
}

/** What each handoff moves, and in which direction. */
function itemFor(handoff: ArravHandoff, gang: ArravGang): { id: number; name: string; giving: boolean } {
    switch (handoff) {
        case 'give-key': return { id: SOA_ID.STORE_KEY, name: 'Key', giving: true };
        case 'take-key': return { id: SOA_ID.STORE_KEY, name: 'Key', giving: false };
        case 'give-half': return { id: ownHalf(gang), name: 'Broken shield', giving: true };
        case 'take-half': return { id: otherHalf(gang), name: 'Broken shield', giving: false };
        case 'give-cert': return { id: SOA_ID.CERTIFICATE, name: 'Certificate', giving: true };
        case 'take-cert': return { id: SOA_ID.CERTIFICATE, name: 'Certificate', giving: false };
    }
}

// Why: partner accepts are not tied to this client's tick rate, so these are wall-clock — a harness at 300ms ticks makes seven ticks about 2.1s, too short for a mutual Trade.
const MEET_MS = 90_000;
const OPEN_MS = 20_000;
const SCREEN_MS = 8_000;
const HANDOFF_MS = 120_000;

function partnerNear(): { index: number } | null {
    const name = ArravConfig.partner.trim();
    if (name.length === 0) {
        return null;
    }
    return Players.query().where(p => namesMatch(p.name ?? '', name)).within(DEFAULT_TRADE_RANGE).nearest();
}

export async function runHandoff(handoff: ArravHandoff, gang: ArravGang, log: (m: string) => void): Promise<boolean> {
    const want = itemFor(handoff, gang);
    // Why: the tests are absolute rather than a before/after delta, because a leg that restarts mid-handshake would otherwise need a baseline it cannot take — and taking one by declining the open window kills the partner's trade.
    // Why: an item already moved into the offer is gone from the pack view, so a give is only believed once the window is shut and the pack reads back.
    const packReadable = (): boolean => Inventory.used() > 0;
    const landed = (): boolean => want.giving
        ? !Trade.active() && packReadable() && Inventory.countById(want.id) === 0
        : Inventory.countById(want.id) > 0;

    if (landed()) {
        return true;
    }
    if (want.giving && Inventory.countById(want.id) === 0 && !Trade.active()) {
        log(`nothing to give: no ${want.name} (${want.id}) in the pack`);
        return false;
    }

    if (!(await Traversal.walkResilient(SOA_TILE.RENDEZVOUS, { radius: 2, attempts: 3, timeoutMs: MEET_MS, log }))) {
        return false;
    }
    // Why: a wait step would park the quest after fifteen identical passes, so the wait for a partner lives inside the leg.
    await Execution.delayUntil(() => partnerNear() !== null || Trade.active(), MEET_MS);
    if (!partnerNear() && !Trade.active()) {
        log(`partner '${ArravConfig.partner}' never arrived at the rendezvous`);
        return false;
    }

    if (!Trade.active()) {
        if (!(await Trade.request(ArravConfig.partner))) {
            log(`could not open a trade with '${ArravConfig.partner}'`);
            return false;
        }
        await Execution.delayUntil(() => Trade.active(), OPEN_MS);
    }

    const deadline = performance.now() + HANDOFF_MS;
    let offered = false;
    let confirmed = false;
    let last = '';
    while (performance.now() < deadline) {
        // Why: the engine shuts the offer screen a tick before it opens the confirm, so one frame with neither up is the handover, not the end of the trade.
        if (!Trade.active()) {
            await Execution.delayTicks(3);
            if (!Trade.active()) {
                break;
            }
        }
        const who = Trade.partner();
        if (who !== null && !namesMatch(who, ArravConfig.partner)) {
            log(`declining a trade from '${who}' — not the configured partner`);
            await Trade.decline();
            return false;
        }

        const screen = Trade.onConfirmScreen() ? 'confirm' : 'offer';
        const ids = (slots: readonly { id: number; count: number }[]): string =>
            slots.map(s => `${s.id}x${s.count}`).join(',') || '-';
        const state = `${screen} modal=${reader.modals().main} want=${want.id}`
            + ` mine=[${ids(Trade.myOffer())}] theirs=[${ids(Trade.theirOffer())}]`;
        if (state !== last) {
            log(`${handoff}: ${state}`);
            last = state;
        }

        if (Trade.onConfirmScreen()) {
            await Trade.accept();
            confirmed = true;
            await Execution.delayUntil(() => !Trade.active(), SCREEN_MS);
            continue;
        }

        if (want.giving && !offered) {
            // Why: Broken shield, Key and Certificate each name more than one object, so the slot is chosen by id.
            if (!(await Trade.offer(want.name, 1, slot => slot.id === want.id))) {
                log(`could not offer ${want.name} (${want.id})`);
                await Trade.decline();
                return false;
            }
            offered = true;
            continue;
        }

        // Why: the taker must not accept an empty offer — the giver may still be walking to the window.
        if (!want.giving && !Trade.theirOffer().some(o => o.id === want.id)) {
            await Execution.delayTicks(1);
            continue;
        }

        // Why: one accept per screen — the engine sets pending on each click and opens the confirm on the second player's, so hammering it adds nothing and the re-clicks race the handover.
        const clicked = await Trade.accept();
        log(`${handoff}: accept on ${screen} -> ${clicked}`);
        await Execution.delayUntil(() => Trade.onConfirmScreen() || !Trade.active(), SCREEN_MS);
    }

    // Why: the pack view only comes back once the window is gone, so nothing is measured before then.
    await Execution.delayUntil(() => !Trade.active(), SCREEN_MS);
    await Execution.delayTicks(2);

    if (!landed()) {
        log(`${handoff} did not move a ${want.name} (offered=${offered} confirmed=${confirmed})`);
        return false;
    }
    if (handoff === 'give-half') {
        ArravHandoffState.gaveHalf = true;
    }
    log(`${handoff} moved a ${want.name}`);
    return true;
}

export function handoffStep(handoff: ArravHandoff, gang: ArravGang): QuestStep {
    return {
        kind: 'custom',
        name: `${handoff} with ${ArravConfig.partner}`,
        run: log => runHandoff(handoff, gang, log)
    };
}
