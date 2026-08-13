import type { GroundItemSnapshot, ItemSnapshot, LocSnapshot, NpcSnapshot, PlayerSnapshot, WorldTile } from '../snapshots/GameSnapshot.js';

export type OpTarget = NpcSnapshot | PlayerSnapshot | LocSnapshot | GroundItemSnapshot | ItemSnapshot;

export type WireCommand =
    | { readonly kind: 'op'; readonly target: OpTarget; readonly operation: number }
    | { readonly kind: 'use-item'; readonly select: ItemSnapshot; readonly target: OpTarget }
    | { readonly kind: 'use-widget'; readonly componentId: number; readonly target: OpTarget }
    | { readonly kind: 'button'; readonly componentId: number; readonly buttonType: number }
    | { readonly kind: 'continue'; readonly componentId: number }
    | { readonly kind: 'close' }
    | { readonly kind: 'count'; readonly value: number }
    | { readonly kind: 'walk'; readonly tile: WorldTile }
    | { readonly kind: 'side-tab'; readonly tab: number }
    | { readonly kind: 'login'; readonly username: string; readonly password: string }
    | { readonly kind: 'clear-local-modal'; readonly componentId: number };

export type SendReason =
    | 'not-attached'
    | 'not-ingame'
    | 'scene-unavailable'
    | 'off-scene'
    | 'level-mismatch'
    | 'stale-target'
    | 'invalid-action'
    | 'unsupported-target'
    | 'component-not-visible'
    | 'client-side-only'
    | 'target-mask-mismatch'
    | 'count-dialog-open'
    | 'no-count-dialog'
    | 'invalid-count'
    | 'no-modal-open'
    | 'no-continue'
    | 'unreachable'
    | 'invalid-tab'
    | 'already-ingame'
    | 'driver-rejected';

export type SendResult =
    | { readonly sent: true; readonly tick: number; readonly command: WireCommand }
    | { readonly sent: false; readonly tick: number; readonly reason: SendReason };

export interface InteractionDriver {
    dispatch(command: WireCommand): boolean;
}

export const SCENE_READY = 2;
