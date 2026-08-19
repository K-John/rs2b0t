// Why: Radimus offers twelve skills over four menu pages and hands out four sessions, so the reward is a choice rather than a fixed branch.
// Why: Prayer is the default because the quest itself is what makes it worth having — three Nezikchened fights and three aggressive guardians are survived on Protect from Melee, and the reward is the largest prayer lump in the 2004 game.

/** The twelve skills `radimus_menu1` through `radimus_menu4` offer, in menu order. */
export const LEGENDS_REWARD_OPTIONS = [
    'Attack', 'Defence', 'Strength',
    'Hitpoints', 'Prayer', 'Magic',
    'Woodcutting', 'Crafting', 'Smithing',
    'Herblore', 'Agility', 'Thieving'
] as const;

export type LegendsReward = (typeof LEGENDS_REWARD_OPTIONS)[number];

export const LegendsConfig: { reward: LegendsReward } = { reward: 'Prayer' };
