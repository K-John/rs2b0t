import type { WorldTile } from '../../apiv2/snapshots/GameSnapshot.js';

export interface Destination {
    readonly label: string;
    readonly group: 'Banks' | 'Cities';
    readonly tile: WorldTile;
}

export const DESTINATIONS: readonly Destination[] = [
    { label: 'Varrock West bank', group: 'Banks', tile: { x: 3185, z: 3440, level: 0 } },
    { label: 'Varrock East bank', group: 'Banks', tile: { x: 3251, z: 3420, level: 0 } },
    { label: 'Draynor bank', group: 'Banks', tile: { x: 3092, z: 3243, level: 0 } },
    { label: 'Falador East bank', group: 'Banks', tile: { x: 3013, z: 3356, level: 0 } },
    { label: 'Falador West bank', group: 'Banks', tile: { x: 2946, z: 3368, level: 0 } },
    { label: 'Edgeville bank', group: 'Banks', tile: { x: 3094, z: 3491, level: 0 } },
    { label: 'Al Kharid bank', group: 'Banks', tile: { x: 3269, z: 3167, level: 0 } },
    { label: "Seers' Village bank", group: 'Banks', tile: { x: 2725, z: 3491, level: 0 } },
    { label: 'Catherby bank', group: 'Banks', tile: { x: 2809, z: 3441, level: 0 } },
    { label: 'Ardougne South bank', group: 'Banks', tile: { x: 2655, z: 3286, level: 0 } },
    { label: 'Ardougne North bank', group: 'Banks', tile: { x: 2617, z: 3332, level: 0 } },
    { label: 'Yanille bank', group: 'Banks', tile: { x: 2612, z: 3093, level: 0 } },
    { label: 'Rellekka bank', group: 'Banks', tile: { x: 2649, z: 3661, level: 0 } },

    { label: 'Lumbridge Castle', group: 'Cities', tile: { x: 3222, z: 3218, level: 0 } },
    { label: 'Varrock Square', group: 'Cities', tile: { x: 3210, z: 3426, level: 0 } },
    { label: 'Varrock north gate', group: 'Cities', tile: { x: 3165, z: 3489, level: 0 } },
    { label: 'Falador Park', group: 'Cities', tile: { x: 2995, z: 3375, level: 0 } },
    { label: 'Draynor Village', group: 'Cities', tile: { x: 3093, z: 3250, level: 0 } },
    { label: 'Al Kharid Palace', group: 'Cities', tile: { x: 3293, z: 3169, level: 0 } },
    { label: 'Port Sarim docks', group: 'Cities', tile: { x: 3029, z: 3217, level: 0 } },
    { label: 'Rimmington', group: 'Cities', tile: { x: 2957, z: 3215, level: 0 } },
    { label: 'Barbarian Village', group: 'Cities', tile: { x: 3083, z: 3419, level: 0 } },
    { label: 'Edgeville', group: 'Cities', tile: { x: 3087, z: 3495, level: 0 } },
    { label: 'Taverley', group: 'Cities', tile: { x: 2895, z: 3443, level: 0 } },
    { label: 'Burthorpe', group: 'Cities', tile: { x: 2899, z: 3545, level: 0 } },
    { label: 'Catherby', group: 'Cities', tile: { x: 2810, z: 3435, level: 0 } },
    { label: 'Camelot', group: 'Cities', tile: { x: 2757, z: 3477, level: 0 } },
    { label: 'East Ardougne', group: 'Cities', tile: { x: 2662, z: 3305, level: 0 } },
    { label: 'Ardougne Zoo', group: 'Cities', tile: { x: 2607, z: 3282, level: 0 } },
    { label: 'Yanille', group: 'Cities', tile: { x: 2605, z: 3096, level: 0 } },
    { label: 'Rellekka', group: 'Cities', tile: { x: 2660, z: 3660, level: 0 } },
    { label: 'Port Khazard', group: 'Cities', tile: { x: 2661, z: 3160, level: 0 } },
    { label: 'Sinclair Mansion', group: 'Cities', tile: { x: 2732, z: 3574, level: 0 } },
    { label: 'Wilderness gate', group: 'Cities', tile: { x: 3087, z: 3520, level: 0 } },
];

export const DESTINATION_LABELS: readonly string[] = [
    ...DESTINATIONS.filter(d => d.group === 'Banks').map(d => d.label).sort(),
    ...DESTINATIONS.filter(d => d.group === 'Cities').map(d => d.label).sort(),
];

export function destinationByLabel(label: string): Destination | null {
    return DESTINATIONS.find(d => d.label === label) ?? null;
}
