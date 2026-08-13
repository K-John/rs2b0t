import { TaskBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { AdvanceDialog } from './Dialog.js';
import { DesignAccept } from './DesignAccept.js';
import { bankChapelStages } from './stages/BankChapel.js';
import { chefStages } from './stages/Chef.js';
import { combatStages } from './stages/Combat.js';
import { magicStages } from './stages/Magic.js';
import { miningStages } from './stages/Mining.js';
import { questGuideStages } from './stages/QuestGuide.js';
import { survivalStages } from './stages/Survival.js';
import { WelcomeScreen } from './WelcomeScreen.js';

export default class TutorialBot extends TaskBot {
    override loopDelay = 600;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.log('TutorialBot start (state-driven; see ADR-0007)');

        this.add(new WelcomeScreen());
        this.add(new AdvanceDialog());
        this.add(new DesignAccept(this));
        for (const t of survivalStages(this)) {
            this.add(t);
        }
        for (const t of chefStages(this)) {
            this.add(t);
        }
        for (const t of questGuideStages(this)) {
            this.add(t);
        }
        for (const t of miningStages(this)) {
            this.add(t);
        }
        for (const t of combatStages(this)) {
            this.add(t);
        }
        for (const t of bankChapelStages(this)) {
            this.add(t);
        }
        for (const t of magicStages(this)) {
            this.add(t);
        }
    }
}
