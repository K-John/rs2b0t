import * as liveAdapter from '#/bot/adapter/ClientAdapter.js';

let adapter: { actions: typeof liveAdapter.actions; reader: typeof liveAdapter.reader } = liveAdapter;

export function useAdapter(next: typeof adapter): void {
    adapter = next;
}
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';

import type { InteractionDriver, OpTarget, WireCommand } from './WireCommand.js';

const NPC = [MiniMenuAction.OP_NPC1, MiniMenuAction.OP_NPC2, MiniMenuAction.OP_NPC3, MiniMenuAction.OP_NPC4, MiniMenuAction.OP_NPC5];
const PLAYER = [MiniMenuAction.OP_PLAYER1, MiniMenuAction.OP_PLAYER2, MiniMenuAction.OP_PLAYER3, MiniMenuAction.OP_PLAYER4, MiniMenuAction.OP_PLAYER5];
const LOC = [MiniMenuAction.OP_LOC1, MiniMenuAction.OP_LOC2, MiniMenuAction.OP_LOC3, MiniMenuAction.OP_LOC4, MiniMenuAction.OP_LOC5];
const OBJ = [MiniMenuAction.OP_OBJ1, MiniMenuAction.OP_OBJ2, MiniMenuAction.OP_OBJ3, MiniMenuAction.OP_OBJ4, MiniMenuAction.OP_OBJ5];
const HELD = [MiniMenuAction.OP_HELD1, MiniMenuAction.OP_HELD2, MiniMenuAction.OP_HELD3, MiniMenuAction.OP_HELD4, MiniMenuAction.OP_HELD5];
const COMPONENT = [MiniMenuAction.INV_BUTTON1, MiniMenuAction.INV_BUTTON2, MiniMenuAction.INV_BUTTON3, MiniMenuAction.INV_BUTTON4, MiniMenuAction.INV_BUTTON5];

const USE_ON: Readonly<Record<OpTarget['kind'], number>> = {
    npc: MiniMenuAction.USEHELD_ONNPC,
    player: MiniMenuAction.USEHELD_ONPLAYER,
    location: MiniMenuAction.USEHELD_ONLOC,
    groundItem: MiniMenuAction.USEHELD_ONOBJ,
    item: MiniMenuAction.USEHELD_ONHELD
};

const AIM_AT: Readonly<Record<OpTarget['kind'], number>> = {
    npc: MiniMenuAction.TGT_NPC,
    player: MiniMenuAction.TGT_PLAYER,
    location: MiniMenuAction.TGT_LOC,
    groundItem: MiniMenuAction.TGT_OBJ,
    item: MiniMenuAction.TGT_HELD
};

const BUTTON: Readonly<Record<number, number>> = {
    1: MiniMenuAction.IF_BUTTON,
    3: MiniMenuAction.CLOSE_BUTTON,
    4: MiniMenuAction.TOGGLE_BUTTON,
    5: MiniMenuAction.SELECT_BUTTON,
    6: MiniMenuAction.PAUSE_BUTTON
};

function opcodeFor(target: OpTarget, operation: number): number | undefined {
    if (!Number.isInteger(operation) || operation < 1 || operation > 5) return undefined;
    const table =
        target.kind === 'npc'
            ? NPC
            : target.kind === 'player'
                ? PLAYER
                : target.kind === 'location'
                    ? LOC
                    : target.kind === 'groundItem'
                        ? OBJ
                        : target.actionFamily === 'held'
                            ? HELD
                            : target.actionFamily === 'component'
                                ? COMPONENT
                                : null;
    return table === null ? undefined : table[operation - 1];
}

function fire(target: OpTarget, opcode: number | undefined): boolean {
    if (opcode === undefined) return false;

    if (target.kind === 'npc' || target.kind === 'player') {
        return adapter.actions.menuAction(opcode, target.index, 0, 0);
    }
    if (target.kind === 'item') {
        return adapter.actions.menuAction(opcode, target.id, target.slot, target.componentId);
    }

    const scene = adapter.reader.sceneBounds();
    if (!scene.available || target.tile.level !== scene.level) return false;
    const lx = target.tile.x - scene.baseX;
    const lz = target.tile.z - scene.baseZ;
    if (lx < 0 || lz < 0 || lx >= scene.width || lz >= scene.height) return false;

    return adapter.actions.menuAction(opcode, target.kind === 'location' ? target.typecode : target.id, lx, lz);
}

function selectThenAim(open: () => boolean, aim: () => boolean): boolean {
    if (!open()) return false;
    const aimed = aim();
    if (!aimed) adapter.actions.menuAction(MiniMenuAction.CANCEL, 0, 0, 0);
    return aimed;
}

export const liveDriver: InteractionDriver = {
    dispatch(command: WireCommand): boolean {
        try {
            switch (command.kind) {
                case 'op':
                    return fire(command.target, opcodeFor(command.target, command.operation));

                case 'use-item':
                    return selectThenAim(
                        () => adapter.actions.menuAction(MiniMenuAction.USEHELD_START, command.select.id, command.select.slot, command.select.componentId),
                        () => fire(command.target, USE_ON[command.target.kind])
                    );

                case 'use-widget':
                    return selectThenAim(
                        () => adapter.actions.menuAction(MiniMenuAction.TGT_BUTTON, 0, 0, command.componentId),
                        () => fire(command.target, AIM_AT[command.target.kind])
                    );

                case 'button': {
                    const opcode = BUTTON[command.buttonType];
                    return opcode === undefined ? false : adapter.actions.menuAction(opcode, 0, 0, command.componentId);
                }

                case 'continue':
                    return adapter.actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, command.componentId);

                case 'close':
                    return adapter.actions.menuAction(MiniMenuAction.CLOSE_BUTTON, 0, 0, 0);

                case 'count':
                    return adapter.actions.answerCountDialog(command.value);

                case 'walk': {
                    const scene = adapter.reader.sceneBounds();
                    if (!scene.available || command.tile.level !== scene.level) return false;
                    return adapter.actions.walkTo(command.tile.x - scene.baseX, command.tile.z - scene.baseZ);
                }

                case 'side-tab':
                    return adapter.actions.clickSideTab(command.tab);

                case 'login':
                    return adapter.actions.login(command.username, command.password);

                case 'clear-local-modal':
                    return adapter.actions.closeMainModal(command.componentId);
            }
        } catch {
            return false;
        }
    }
};
