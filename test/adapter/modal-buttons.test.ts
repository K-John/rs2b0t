import { afterEach, describe, expect, test } from 'bun:test';

import { readModalButtons } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ButtonType, ComponentType } from '#/client/config/IfType.js';

const originalInterfaces = IfType.list;

afterEach(() => {
    IfType.list = originalInterfaces;
});

// Why: the archive writes a `buttonType` of 0 for a component that declares no `buttontype`, which is not the -1 the class starts at.
function component(id: number, type: ComponentType): IfType {
    const result = new IfType();
    result.id = id;
    result.type = type;
    result.buttonType = 0;
    return result;
}

// Why: `death_dice` puts its two buttons inside layers the script hides and unhides, and the layer is
// where `if_sethide` lands. The button itself is never marked.
function installDice(): { root: number; roll: number; go: number; rollLayer: IfType; goLayer: IfType } {
    const root = component(6675, ComponentType.TYPE_LAYER);
    const rollLayer = component(8420, ComponentType.TYPE_LAYER);
    const roll = component(8421, ComponentType.TYPE_TEXT);
    const goLayer = component(8422, ComponentType.TYPE_LAYER);
    const go = component(8423, ComponentType.TYPE_TEXT);
    const close = component(8427, ComponentType.TYPE_TEXT);
    const verdict = component(8426, ComponentType.TYPE_TEXT);

    roll.text = 'Roll Dice!';
    roll.buttonType = ButtonType.BUTTON_OK;
    roll.buttonText = 'Ok';
    go.text = 'Continue...';
    go.buttonType = ButtonType.BUTTON_CONTINUE;
    go.buttonText = 'Continue';
    close.text = 'Close Window';
    close.buttonType = ButtonType.BUTTON_CLOSE;
    // Why: `player_roll` writes this one, and "Harold rolls..." looked like the Roll Dice button to a filter that let plain text through.
    verdict.text = 'Harold rolls...';

    rollLayer.hide = true;
    rollLayer.children = [roll.id];
    goLayer.hide = true;
    goLayer.children = [go.id];
    root.children = [rollLayer.id, goLayer.id, verdict.id, close.id];

    IfType.list = [];
    for (const com of [root, rollLayer, roll, goLayer, go, verdict, close]) {
        IfType.list[com.id] = com;
    }
    return { root: root.id, roll: roll.id, go: go.id, rollLayer, goLayer };
}

describe('a modal reports which of its buttons a script has armed', () => {
    test('a button inside a hidden layer reads as hidden', () => {
        const dice = installDice();
        expect(readModalButtons(dice.root)).toEqual([
            { comId: dice.roll, label: 'Roll Dice!', menu: 'Ok', hidden: true, pause: false },
            { comId: dice.go, label: 'Continue...', menu: 'Continue', hidden: true, pause: true }
        ]);
    });

    test('unhiding the layer arms the button inside it', () => {
        const dice = installDice();
        dice.rollLayer.hide = false;
        const roll = readModalButtons(dice.root).find(button => button.label === 'Roll Dice!');
        expect(roll?.hidden).toBe(false);
        expect(readModalButtons(dice.root).find(button => button.pause)?.hidden).toBe(true);
    });

    test('the pause button is told apart from the ordinary one', () => {
        const dice = installDice();
        const buttons = readModalButtons(dice.root);
        expect(buttons.filter(button => button.pause).map(button => button.comId)).toEqual([dice.go]);
    });

    test('the close leaf is not offered as a button', () => {
        const dice = installDice();
        expect(readModalButtons(dice.root).some(button => button.label === 'Close Window')).toBe(false);
    });

    test('plain text is not offered as a button, whatever it says', () => {
        const dice = installDice();
        expect(readModalButtons(dice.root).some(button => button.label === 'Harold rolls...')).toBe(false);
    });
});
