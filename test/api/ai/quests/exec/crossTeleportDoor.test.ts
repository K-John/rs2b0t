import { afterAll, beforeEach, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { crossTeleportDoor } from '#/bot/api/ai/quests/exec/prompts.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const DOOR_ID = 1536;
const STAND = new Tile(2774, 3187, 0);

let refusal: string | null;
let polls: number;

const leaf = {
    id: DOOR_ID,
    name: 'Door',
    tile: () => ({ x: 2774, z: 3188, level: 0 }),
    actions: () => ['Open'],
    interact: async (): Promise<boolean> => {
        if (refusal) {
            GameMessages.record(refusal);
        }
        return true;
    }
};

function chain(): unknown {
    const self = {
        action: () => self,
        name: () => self,
        within: () => self,
        where: () => self,
        nearest: () => leaf
    };
    return self;
}

const restore = [
    stubProps(Execution, {
        delayTicks: async (): Promise<void> => {},
        // Why: delayUntil polls once a tick up to its cap, so the poll count is what a stall costs.
        delayUntil: async (fn: () => boolean, ms?: number): Promise<boolean> => {
            const rounds = Math.max(1, Math.round((ms ?? 0) / 600));
            for (let i = 0; i < rounds; i++) {
                polls++;
                if (fn()) {
                    return true;
                }
            }
            return fn();
        }
    }),
    stubProps(Traversal, { walkResilient: async (): Promise<boolean> => true }),
    stubProps(Locs, { query: () => chain() as never }),
    stubProps(reader, { modals: () => ({ main: -1 }) as never })
];

afterAll(() => restore.forEach(fn => fn()));

beforeEach(() => {
    refusal = null;
    polls = 0;
    GameMessages.reset();
});

// Why: `open_and_close_door` prints nothing on a crossing, so a message instead of the teleport is the script refusing — without watching for it the crossing polls out its full cap.
test('a refused door gives up as soon as the script answers', async () => {
    refusal = 'This door is securely locked.';

    const crossed = await crossTeleportDoor({ id: DOOR_ID, stand: STAND, isFar: () => false, log: () => {} });

    expect(crossed).toBe(false);
    // Why: one poll for the box-or-refusal wait and one for the crossing, both cut short by the message — against a cap of three each.
    expect(polls).toBeLessThanOrEqual(2);
});

test('a silent door still polls out its cap before giving up', async () => {
    const crossed = await crossTeleportDoor({ id: DOOR_ID, stand: STAND, isFar: () => false, log: () => {} });

    expect(crossed).toBe(false);
    expect(polls).toBeGreaterThan(1);
});

test('a crossing that lands is not read as a refusal by its own narration', async () => {
    refusal = 'You go through the door.';
    let far = false;

    const crossed = await crossTeleportDoor({
        id: DOOR_ID,
        stand: STAND,
        isFar: () => far,
        log: () => {}
    });

    expect(crossed).toBe(false);
    far = true;
    expect(await crossTeleportDoor({ id: DOOR_ID, stand: STAND, isFar: () => far, log: () => {} })).toBe(true);
});
