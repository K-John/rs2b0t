import { describe, expect, test } from 'bun:test';

import { LQ_STAGE } from '#/bot/api/ai/quests/defs/legends/areas.js';
import { parseLegendsJournal } from '#/bot/api/ai/quests/defs/legends/journal.js';

/** What the player is carrying, for the branches `legends_journal.rs2` reads off the pack. */
interface Pack {
    blessedBowl?: boolean;
    goldBowl?: boolean;
    book?: boolean;
    seeds?: boolean;
    germSeeds?: boolean;
    braveryPotion?: boolean;
    herbs?: boolean;
    crystal?: boolean;
    glowCrystal?: boolean;
    dagger?: boolean;
    holyForce?: boolean;
    totem?: boolean;
    gift?: boolean;
    killedViyeldi?: boolean;
    givenDagger?: boolean;
    heroesLeft?: boolean;
}

// Why: transcribed line for line from `legends_journal.rs2`, which is the only place these bodies exist.
// Why: a needle that drifts from the server's wording reads every stage as the one below it, and the module then repeats a leg for ever.
function journalFor(stage: number, pack: Pack = {}): string {
    const out: string[] = [];
    const add = (line: string): void => {
        out.push(line);
    };

    if (stage === LQ_STAGE.COMPLETE) {
        add('@str@Radimus Erkle asked me to go to map the Kharazi Jungle. @str@In addition, he asked me to meet with the tribe of the @str@Kharazi Jungle and return with some sort of gift or token @str@to display in the Legends Guild.');
        add('@str@Radimus Erkle granted me access to the Legends\' Guild|@str@facilities.');
        add('@red@QUEST COMPLETE!');
        return out.join('|');
    }

    if (stage === LQ_STAGE.NOT_STARTED) {
        add('@dbl@I can start this quest by speaking to @dre@Radimus Erkle@dbl@ in the');
        add('@dre@Legends Guild@dbl@, North East of @dre@Ardougne@dbl@.');
        add('@dbl@To start this quest I need to complete the following:-');
        add('@dre@\'Heroes Quest\'');
        add('@dbl@And gain a total of @dre@107 quest points@dbl@.');
        return out.join('|');
    }

    if (stage >= LQ_STAGE.SWUNG_BULLROARER) {
        add('@str@Radimus Erkle asked me to map the Kharazi jungle');
        add('@str@and bring back a gift to display in the Legends Guild.');
    } else {
        add('@dre@Radimus Erkle@dbl@ asked me to map the @dre@Kharazi jungle@dbl@');
        add('@dbl@and bring back a @dre@gift@dbl@ to display in the @dre@Legends Guild.');
    }

    if (stage >= LQ_STAGE.MAPPED_JUNGLE) {
        add('@str@I have mapped the Kharazi Jungle for Radimus Erkle.');
    } else {
        add('@dbl@To get in to the @dre@Kharazi Jungle@dbl@ I\'ll need-:');
        add('@dbl@An @dre@axe.');
    }

    if (stage >= LQ_STAGE.SWUNG_BULLROARER) {
        add('@str@A local forester took a copy of my Kharazi map and in');
        add('@str@return I got a bullroarer which I used to attract \'Gujuo\'.');
    } else if (stage === LQ_STAGE.GOT_BULLROARER) {
        add('@str@A local forester took a copy of my Kharazi map and in');
        add('@str@return I got a bullroarer which may attract a native.');
    } else if (stage === LQ_STAGE.MAPPED_JUNGLE) {
        add('@dbl@I need to make friends with a @dre@native@dbl@ and bring back a @dre@gift@dbl@ which can be displayed in the @dre@Legends Guild@dbl@.');
    }

    if (stage > LQ_STAGE.ACCEPTED_RESCUE) {
        add('@str@I agreed to help Gujuo by freeing a Shaman. The shaman|@str@is in some caves in North West Kharazi.');
    } else if (stage === LQ_STAGE.ACCEPTED_RESCUE) {
        add('@dbl@I agreed to help @dre@Gujuo@dbl@ by releasing a @dre@Shaman@dbl@ who is being held in some @dre@caves@dbl@ in @dre@North West Kharazi@dbl@.');
    } else if (stage === LQ_STAGE.SWUNG_BULLROARER) {
        add('@dbl@I\'ve met \'@dre@Gujuo@dbl@\', a @dre@Kharazi Jungle native@dbl@. Perhaps I can make friends with him?');
    } else if (stage === LQ_STAGE.GOT_BULLROARER) {
        add('@dbl@I need to make friends with a @dre@native@dbl@ and bring back a @dre@gift@dbl@ which can be displayed in the @dre@Legends Guild@dbl@.');
    }

    if (stage >= LQ_STAGE.SPOKE_UNGADULU) {
        add('@str@The Shaman Ungadulu is trapped in a flaming octagon.');
    } else if (stage === LQ_STAGE.FOUND_ENTRANCE) {
        add('@dbl@I need to get some @dre@Yommi tree seeds@dbl@ from @dre@Ungadulu@dbl@.');
    }

    if (stage > LQ_STAGE.SPOKE_UNGADULU) {
        add('@str@Ungadulu acted strange and mentioned sacred water.');
    } else if (stage === LQ_STAGE.SPOKE_UNGADULU) {
        add('@dre@Ungadulu@dbl@ is acting weird and talking a lot of nonsense, perhaps someone else can help me understand what he\'s talking about.');
        add('@dbl@I need to get some @dre@Yommi tree seeds@dbl@ from @dre@Ungadulu@dbl@.');
    }

    if (stage >= LQ_STAGE.SUMMONED_NEZI_FIRE) {
        add('@str@I used sacred water on flames to get into octagon.');
    } else if (stage >= LQ_STAGE.FILLED_BOWL) {
        add('@str@Gujuo said I need a blessed vessel of sun metal.');
    } else if (stage === LQ_STAGE.ASKED_GUJUO_WATER) {
        if (pack.blessedBowl) {
            add('@str@Gujuo said I need a blessed vessel of sun metal.');
            add('@dbl@I have a @dre@blessed golden bowl@dbl@, now I need some @dre@sacred water@dbl@.');
        } else if (pack.goldBowl) {
            add('@str@Gujuo said I need a blessed vessel of sun metal.');
            add('@dbl@I have a @dre@golden bowl@dbl@, now it needs to be @dre@blessed@dbl@.');
        } else {
            add('@dbl@Gujuo mentioned a @dre@blessed vessel@dbl@ made from @dre@metal@dbl@ of the @dre@sun@dbl@. Perhaps I can get some @dre@sacred water@dbl@ with this?');
        }
    }

    if (stage >= LQ_STAGE.SUMMONED_NEZI_FIRE) {
        add('@str@I used the book of binding on Ungadulu and|@str@a demon called Nezikchened appeared. I think that @str@Ungadulu is possessed by this demon.');
    } else if (stage === LQ_STAGE.FILLED_BOWL) {
        add('@dbl@I have some @dre@sacred water@dbl@. @dre@Ungadulu@dbl@ mentioned that it may help me to get closer to him. I need get some @dre@Yommi tree seeds@dbl@ from @dre@Ungadulu@dbl@.');
        if (pack.book) {
            add('@dbl@I found a \'@dre@book of binding@dbl@\' which may give some clue as to how I can release @dre@Ungadulu@dbl@.');
        }
    }

    if (stage >= LQ_STAGE.DEFEATED_NEZI_FIRE) {
        add('@str@I used the book of binding to force the demon|@str@Nezikchened out of Ungadulu. I then slew the demon.');
    } else if (stage >= LQ_STAGE.SUMMONED_NEZI_FIRE) {
        add('@dbl@I need to release @dre@Ungadulu@dbl@ so that I can get some @dre@Yommi tree seeds@dbl@ from him.');
    }

    if (stage >= LQ_STAGE.POOL_DRIED) {
        add('@str@Ungadulu studies supernatural spirits!');
        add('@str@I used sacred water to germinate the Yommi tree seeds|@str@that Ungadulu gave me.');
    } else if (stage === LQ_STAGE.GERMINATED_SEEDS) {
        add('@dbl@I have some @dre@germinated Yommi tree seeds@dbl@. I just need to plant them now in some @dre@fertile soil@dbl@.');
        add('@dre@Ungadulu@dbl@ studies supernatural @dre@spirits!');
    } else if (stage === LQ_STAGE.DEFEATED_NEZI_FIRE) {
        if (pack.seeds) {
            add('@dbl@I have some @dre@Yommi tree seeds@dbl@ from @dre@Ungadulu@dbl@. I need to @dre@germinate@dbl@ them with @dre@sacred water@dbl@ before planting them in @dre@fertile soil@dbl@.');
            add('@dre@Ungadulu@dbl@ studies supernatural @dre@spirits!');
        } else {
            add('@dbl@I need to get some @dre@Yommi tree seeds@dbl@ from @dre@Ungadulu@dbl@ now that I have released him from his possession.');
        }
    }

    if (stage >= LQ_STAGE.ENTER_LOWER_DUNGEON) {
        add('@str@Gujuo said the sacred water source is in the Viyeldi caves.|@str@I had to make a bravery potion in order to enter the|@str@caves. The Viyeldi caves are under the caves where|@str@Ungadulu is.');
    } else if (stage === LQ_STAGE.TALK_GUJUO_POOL) {
        if (pack.braveryPotion) {
            add('@str@Gujuo said the sacred water source is in the Viyeldi caves.');
            add('@str@I have made a bravery potion in order to enter the caves.');
            add('@dbl@I need to find the @dre@Viyeldi@dbl@ caves and the source of the @dre@sacred water@dbl@.');
        } else if (pack.herbs) {
            add('@dbl@I need to make the @dre@bravery potion@dbl@ using the @dre@Snake weed@dbl@ and @dre@Ardrigal@dbl@ I have.');
        } else {
            add('@dre@Gujuo@dbl@ said the @dre@Viyeldi caves@dbl@ might be the @dre@source@dbl@ of the @dre@sacred water@dbl@. I need to make a @dre@bravery potion@dbl@ before I can enter.');
            add('@dbl@I need to collect:-');
            add('@dre@Snake weed');
        }
    } else if (stage === LQ_STAGE.POOL_DRIED) {
        add('@dbl@I need to get some more @dre@sacred water@dbl@ in order for the @dre@Yommi tree@dbl@ to grow.');
    }

    if (stage === LQ_STAGE.CRYSTAL_SMELTED) {
        add('@str@I fixed chunks of crystal into dragon heart shape.');
    } else if (stage === LQ_STAGE.ENTER_LOWER_DUNGEON) {
        add('@dbl@I\'m able to access the @dre@Viyeldi Caves@dbl@. I need to find the source of @dre@sacred water@dbl@, which may be protected.');
    }

    if (stage === LQ_STAGE.HEART_IN_RECESS) {
        add('@str@I made a glowing dragon heart stone from chunks of|@str@crystal which gave me access to a strange cave.');
    } else if (stage === LQ_STAGE.CRYSTAL_SMELTED) {
        if (pack.glowCrystal) {
            add('@dbl@I have a @dre@glowing dragon heart@dbl@ crystal which might help me to gain access to the @dre@sacred water@dbl@.');
        } else if (pack.crystal) {
            add('@dbl@I have a @dre@Dragon heart@dbl@ crystal which might help me to gain @dbl@access to the @dre@sacred water@dbl@.');
        }
        add('@dbl@I need to find the @dre@source@dbl@ of the @dre@sacred water@dbl@.');
    }

    if (stage === LQ_STAGE.PUSHED_BOULDER) {
        add('@str@A strange spirit seems to be guarding the sacred water.');
    } else if (stage === LQ_STAGE.HEART_IN_RECESS) {
        add('@dbl@I need to find the source of the @dre@sacred water@dbl@ and collect some so I can grow a @dre@Yommi tree@dbl@.');
    }

    if (stage >= LQ_STAGE.DEFEATED_NEZI_WATER && !pack.killedViyeldi) {
        add('@str@The spirit Echnid Zeikin gave me a dagger and asked me|@str@to kill Viyeldi. The Spirit turned out to be a demon in|@str@disguise. I wasn\'t tricked, though and I defeated the|@str@demon with Ungadulu\'s help.');
    } else if (stage >= LQ_STAGE.RECEIVED_DAGGER) {
        add('@str@The spirit gave me a dagger and said I have to kill Viyeldi|@str@with it if I want to get some sacred water.');
    }

    if (stage === LQ_STAGE.RECEIVED_DAGGER && pack.killedViyeldi) {
        if (pack.givenDagger) {
            add('@str@I killed Viyeldi with the black dagger and I returned it to|@str@the spirit, but it turned into the demon.');
        } else {
            add('@str@I\'ve killed Viyeldi with a dagger the spirit gave me.');
        }
    }

    if (stage >= LQ_STAGE.DEFEATED_NEZI_WATER && pack.killedViyeldi) {
        add('@str@I was tricked by the demon into killing Viyeldi but I|@str@managed to destroy the demon in the end.');
    }

    if (stage >= LQ_STAGE.SPAWNED_NEZI_FINAL) {
        add('@str@I made a Yommi tree totem pole by growing a Yommi|@str@tree and watering it with sacred water.');
    } else if (stage === LQ_STAGE.COLLECTED_TOTEM) {
        add('@str@I collected some sacred water in order to I made a totem|@str@pole from a Yommi tree.');
    } else if (stage === LQ_STAGE.SACRED_WATER) {
        add('@str@I now have some pure sacred water.');
    } else if (stage === LQ_STAGE.DEFEATED_NEZI_WATER) {
        add('@str@I found the source of the sacred water!');
    } else if (stage === LQ_STAGE.PUSHED_BOULDER || stage === LQ_STAGE.RECEIVED_DAGGER) {
        add('@dbl@I need to find a way to get some @dre@sacred water@dbl@.');
    }

    if (stage >= LQ_STAGE.SPAWNED_NEZI_FINAL) {
        add('@str@I used the totem pole on an evil totem pole and the demon|@str@Nezikchened appeared again.');
    } else if (stage === LQ_STAGE.COLLECTED_TOTEM) {
        add('@dbl@I\'ve got a @dre@Yommi tree totem pole@dbl@, I need to place this somewhere so that @dre@Gujuo@dbl@ can gather his people together. Perhaps then I can make @dre@friends@dbl@ with the Kharazi tribe.');
    } else if (stage === LQ_STAGE.SACRED_WATER) {
        add('@dbl@I can now try to grow a @dre@Yommi tree@dbl@ in order to make a @dre@Yommi tree totem pole@dbl@.');
    } else if (stage === LQ_STAGE.DEFEATED_NEZI_WATER) {
        add('@dbl@I need to collect some @dre@sacred water@dbl@ in order to grow a @dre@Yommi tree@dbl@ and make it into a @dre@totem pole@dbl@.');
    }

    if (stage >= LQ_STAGE.DEFEATED_NEZI_FINAL) {
        if (!pack.killedViyeldi) {
            add('@str@I fought Nezikchened and finally defeated him.');
        } else {
            add('@str@Nezikchened appeared and summoned the Viyeldi fighters.');
            add('@str@I fought them all and eventually defeated Nezikchened.');
        }
    } else if (stage === LQ_STAGE.SPAWNED_NEZI_FINAL) {
        if (pack.killedViyeldi && pack.heroesLeft) {
            add('@dbl@I have to defeat the demon @dre@Nezikchened@dbl@ in order to replace the @dre@evil totem pole.');
        } else {
            add('@dbl@I have to defeat the demon @dre@Nezikchened@dbl@ and the @dre@Viyeldi fighters@dbl@ in order to replace the evil totem pole.');
        }
    }

    if (stage >= LQ_STAGE.GOT_GILDED_TOTEM) {
        add('@str@I replaced the evil totem with the good one I made.');
    } else if (stage >= LQ_STAGE.DEFEATED_NEZI_FINAL) {
        if (pack.totem) {
            add('@dbl@I need to replace the @dre@evil totem pole@dbl@ with the one I made.');
        } else {
            add('@dbl@I don\'t have a totem pole, I need to make a new one.');
        }
    }

    if (stage > LQ_STAGE.GOT_GILDED_TOTEM) {
        add('@str@After mapping the Kharazi Jungle for Radimus Erkle|@str@I freed the Kharazi tribe from the power a foul demon|@str@called Nezikchened.');
        add('@str@I\'ve handed the totem pole and map over to Radimus.');
    } else if (stage === LQ_STAGE.GOT_GILDED_TOTEM) {
        if (pack.gift) {
            add('@str@Gujuo gave me a fine gilded totem pole for freeing the|@str@Kharazi Jungle from Nezikchened\'s demonic power.');
            add('@dbl@The @dre@gilded totem pole@dbl@ will make a find addition to the @dre@Legends Guild@dbl@.');
        } else {
            add('@dbl@Perhaps @dre@Gujuo@dbl@ can call his people together now and I can make @dre@friends@dbl@ with the @dre@Kharazi Jungle tribe@dbl@.');
        }
    }

    const remaining = Math.floor((LQ_STAGE.TRAINING_4 - stage) / 5);
    const words = ['one', 'one', 'two', 'three', 'four'];
    const completed = 4 - remaining;
    if (stage > LQ_STAGE.RETURNED_TO_RADIMUS) {
        add('@str@The gilded totem pole is on display in the Legends Guild @str@for all to see.');
        if (completed > 0) {
            add(`@str@Radimus has given me ${words[completed]} training ${completed === 1 ? 'session' : 'sessions'} as reward.`);
        }
    } else if (stage === LQ_STAGE.RETURNED_TO_RADIMUS) {
        add('@dre@Radimus@dbl@ asked me to join him inside the @dre@Legends Guild@dbl@ to discuss my reward.');
    }

    if (stage > LQ_STAGE.RETURNED_TO_RADIMUS) {
        add('@dre@Radimus Erkle@dbl@, the @dre@Grand Vizier@dbl@ of the @dre@Legends Guild@dbl@ has offered me some @dre@training@dbl@ for completing the @dre@quest@dbl@.');
        add(`@dbl@I still have @dre@${words[remaining] ?? 'one'}@dbl@ training ${remaining === 1 ? 'session' : 'sessions'} with @dre@Radimus@dbl@.`);
    }

    return out.join('|');
}

const STAGES: readonly number[] = [
    LQ_STAGE.NOT_STARTED, LQ_STAGE.STARTED, LQ_STAGE.MAPPED_JUNGLE, LQ_STAGE.GOT_BULLROARER,
    LQ_STAGE.SWUNG_BULLROARER, LQ_STAGE.ACCEPTED_RESCUE, LQ_STAGE.FOUND_ENTRANCE, LQ_STAGE.SPOKE_UNGADULU,
    LQ_STAGE.ASKED_GUJUO_WATER, LQ_STAGE.FILLED_BOWL, LQ_STAGE.SUMMONED_NEZI_FIRE, LQ_STAGE.DEFEATED_NEZI_FIRE,
    LQ_STAGE.GERMINATED_SEEDS, LQ_STAGE.POOL_DRIED, LQ_STAGE.TALK_GUJUO_POOL, LQ_STAGE.ENTER_LOWER_DUNGEON,
    LQ_STAGE.CRYSTAL_SMELTED, LQ_STAGE.HEART_IN_RECESS, LQ_STAGE.PUSHED_BOULDER, LQ_STAGE.RECEIVED_DAGGER,
    LQ_STAGE.DEFEATED_NEZI_WATER, LQ_STAGE.SACRED_WATER, LQ_STAGE.COLLECTED_TOTEM, LQ_STAGE.SPAWNED_NEZI_FINAL,
    LQ_STAGE.DEFEATED_NEZI_FINAL, LQ_STAGE.GOT_GILDED_TOTEM, LQ_STAGE.RETURNED_TO_RADIMUS,
    LQ_STAGE.TRAINING_1, LQ_STAGE.TRAINING_2, LQ_STAGE.TRAINING_3, LQ_STAGE.TRAINING_4, LQ_STAGE.COMPLETE
];

describe('parseLegendsJournal', () => {
    // Why: stages 35 and 40 render the same body, the "replaced the evil totem" line is gated on 45, so 40 is expected to read back as 35 and `decide()` splits the pair by what is carried.
    const SAME_BODY: Record<number, number> = { [LQ_STAGE.REPLACED_TOTEM]: LQ_STAGE.DEFEATED_NEZI_FINAL };

    for (const stage of STAGES) {
        test(`server stage ${stage} reads back`, () => {
            expect(parseLegendsJournal(journalFor(stage))?.stage).toBe(SAME_BODY[stage] ?? stage);
        });
    }

    test('stage 40 is indistinguishable from 35 and reads back as 35', () => {
        expect(parseLegendsJournal(journalFor(LQ_STAGE.REPLACED_TOTEM))?.stage).toBe(LQ_STAGE.DEFEATED_NEZI_FINAL);
    });

    test('a bowl in the pack does not push stage 8 forward', () => {
        expect(parseLegendsJournal(journalFor(LQ_STAGE.ASKED_GUJUO_WATER, { goldBowl: true }))?.stage)
            .toBe(LQ_STAGE.ASKED_GUJUO_WATER);
        expect(parseLegendsJournal(journalFor(LQ_STAGE.ASKED_GUJUO_WATER, { blessedBowl: true }))?.stage)
            .toBe(LQ_STAGE.ASKED_GUJUO_WATER);
    });

    test('the bravery-potion branches all read as stage 15', () => {
        for (const pack of [{}, { herbs: true }, { braveryPotion: true }]) {
            expect(parseLegendsJournal(journalFor(LQ_STAGE.TALK_GUJUO_POOL, pack))?.stage).toBe(LQ_STAGE.TALK_GUJUO_POOL);
        }
    });

    test('a killed Viyeldi is flagged from the dagger stage on', () => {
        const killed = parseLegendsJournal(journalFor(LQ_STAGE.RECEIVED_DAGGER, { killedViyeldi: true }));
        expect(killed?.flags.has('killed-viyeldi')).toBe(true);
        const clean = parseLegendsJournal(journalFor(LQ_STAGE.RECEIVED_DAGGER));
        expect(clean?.flags.has('killed-viyeldi')).toBe(false);
    });

    test('handing the dagger back is its own flag', () => {
        const given = parseLegendsJournal(journalFor(LQ_STAGE.RECEIVED_DAGGER, { killedViyeldi: true, givenDagger: true }));
        expect(given?.flags.has('given-dagger')).toBe(true);
    });

    test('crystals already in the lava furnace are counted', () => {
        const none = parseLegendsJournal(journalFor(LQ_STAGE.ENTER_LOWER_DUNGEON));
        expect(none?.flags.has('crystals-placed:0')).toBe(true);
        const one = parseLegendsJournal(
            journalFor(LQ_STAGE.ENTER_LOWER_DUNGEON) + '|@dbl@I\'ve placed a @dre@crystal@dbl@ chunk in a @dre@lava furnace@dbl@.'
        );
        expect(one?.flags.has('crystals-placed:1')).toBe(true);
        const two = parseLegendsJournal(
            journalFor(LQ_STAGE.ENTER_LOWER_DUNGEON) + '|@dbl@I\'ve place some @dre@crystal chunks@dbl@ in a @dre@lava furnace@dbl@.'
        );
        expect(two?.flags.has('crystals-placed:2')).toBe(true);
    });

    test('an unparseable body is undefined rather than stage zero', () => {
        expect(parseLegendsJournal('@dbl@Something else entirely.')).toBeUndefined();
    });
});
