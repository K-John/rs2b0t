import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    globalIgnores(['src/3rdparty/', 'out/', 'desktop/', 'packages/', 'templates/', 'public-bot/', '.claude/', 'identifier.js']),
    { files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], plugins: { js }, extends: ['js/recommended'], languageOptions: { globals: globals.browser } },
    tseslint.configs.recommended,
    {
        rules: {
            indent: ['error', 4, { SwitchCase: 1 }],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],

            'no-constant-condition': ['error', { checkLoops: false }],
            'no-case-declarations': 'error',
            '@typescript-eslint/no-namespace': 'error',
            '@typescript-eslint/no-explicit-any': 'warn',

            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'all',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_'
                }
            ]
        }
    },

    // The ported 2004 client swallows exceptions in dozens of places, faithfully to the
    // original. It is a frozen port, so an empty catch there is intent rather than an
    // oversight. Everything we write ourselves keeps the rule and comments the intent.
    {
        files: ['src/client/**/*.ts', 'src/dash3d/**/*.ts', 'src/graphics/**/*.ts', 'src/mapview/**/*.ts', 'src/config/**/*.ts', 'src/io/**/*.{ts,js}', 'src/sound/**/*.ts', 'src/datastruct/**/*.ts', 'src/wordfilter/**/*.ts'],
        rules: {
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },

    // ---- rs2b0t fences ----
    // Only adapter/ may name client internals; everything else in src/bot/
    // imports the adapter. Protocol const-enums are exempt (inlined, no
    // runtime coupling).
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/adapter/**', 'src/bot/runtime/BotClient.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['\\#/client/*', '\\#/io/*', '\\#/config/*', '\\#/dash3d/*', '\\#/datastruct/*', '\\#/graphics/*', '\\#/sound/*', '\\#/wordfilter/*', '\\#3rdparty/*', '!\\#/io/ServerProt.js', '!\\#/io/ClientProt.js', '!\\#/dash3d/CollisionFlag.js', '!\\#/client/MiniMenuAction.js'],
                            message: 'Only src/bot/adapter/ may touch client internals.'
                        }
                    ]
                }
            ]
        }
    },
    // Only ui/ and the entrypoints may touch the DOM (keeps headless viable).
    // The MultiBox manager is a second DOM entrypoint: main.ts (its bundle
    // entry) and its DOM view layers DomSlotOps.ts and ProfileChooser.ts
    // (analogous to ui/) are exempted the same way; the rest of
    // src/bot/multibox/ stays fenced.
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/ui/**', 'src/bot/main.ts', 'src/bot/multibox/DomSlotOps.ts', 'src/bot/multibox/ProfileChooser.ts', 'src/bot/multibox/TabBar.ts', 'src/bot/multibox/VaultPrompt.ts', 'src/bot/multibox/main.ts'],
        rules: {
            'no-restricted-globals': ['error', { name: 'document', message: 'DOM only in src/bot/ui/, main.ts, and src/bot/multibox/{DomSlotOps,ProfileChooser,TabBar,VaultPrompt,main}.ts.' }, { name: 'window', message: 'DOM only in src/bot/ui/, main.ts, and src/bot/multibox/{DomSlotOps,ProfileChooser,TabBar,VaultPrompt,main}.ts.' }]
        }
    },

    // api/ sits above adapter/, nav/ and data/, and on the host substrate
    // (Settings, BotHost, Scheduler) that Execution/Game/loadouts genuinely need.
    // It must not reach up into script lifecycle or the layers that consume it.
    // Promoted to 'error' once the reorganization lands.
    {
        files: ['src/bot/api/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'warn',
                {
                    patterns: [
                        {
                            group: [
                                '**/scripts/**',
                                '**/quests/**',
                                '**/clues/**',
                                '**/ui/**',
                                '**/multibox/**',
                                '**/runtime/**',
                                '!**/runtime/Settings.js',
                                '!**/runtime/BotHost.js',
                                '!**/runtime/Scheduler.js'
                            ],
                            message: 'api/ may stand on runtime/{Settings,BotHost,Scheduler} only — never on script lifecycle or the layers that consume it.'
                        }
                    ]
                }
            ]
        }
    },
    // data/ holds inert catalogs: tables plus pure resolvers over them, no live
    // game reads. geometry/ is a top-level leaf, so no re-inclusion is needed —
    // gitignore semantics cannot re-admit a path under an excluded parent, which
    // is why geometry does not live under api/.
    {
        files: ['src/bot/data/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'warn',
                {
                    patterns: [
                        {
                            group: ['**/api/**', '**/nav/**', '**/scripts/**', '**/quests/**', '**/clues/**', '**/ui/**', '**/runtime/**', '**/multibox/**', '**/adapter/**'],
                            allowTypeImports: true,
                            message: 'data/ is inert — value imports only from geometry/. Type-only imports are fine.'
                        }
                    ]
                }
            ]
        }
    },
    // The published surface is decidable: abi.ts pulls only from api/, data/, nav/.
    {
        files: ['src/bot/runtime/abi.ts'],
        rules: {
            'no-restricted-imports': [
                'warn',
                {
                    patterns: [
                        {
                            group: ['**/scripts/**', '**/clues/**', '**/ui/**', '**/multibox/**', '**/quests/**', '**/events/**', '**/input/**'],
                            message: 'abi.ts publishes from api/, data/ and nav/ only.'
                        }
                    ]
                }
            ]
        }
    }
]);
