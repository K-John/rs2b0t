import type { ReadContext } from '../ReadApi.js';
import type { SendReason } from './WireCommand.js';

export type Evidence = (now: ReadContext, before: ReadContext) => boolean;

export type Outcome =
    | { readonly kind: 'refused'; readonly reason: SendReason; readonly tick: number }
    | { readonly kind: 'matched'; readonly arm: string; readonly now: ReadContext; readonly before: ReadContext; readonly tick: number }
    | { readonly kind: 'expired'; readonly now: ReadContext; readonly before: ReadContext; readonly tick: number };

export interface SettleOptions {
    readonly arms: Readonly<Record<string, Evidence>>;

    readonly since?: ReadContext;

    readonly budgetTicks: number;

    readonly budgetMs?: number;
}
