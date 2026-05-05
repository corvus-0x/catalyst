/**
 * Ambient declaration for the `tinykeys` package.
 *
 * tinykeys 3.x ships its types alongside the dist bundle but its package.json
 * `exports` field omits a "types" subpath, so TypeScript with
 * `moduleResolution: "bundler"` can't pick them up via a bare
 * `import { ... } from "tinykeys"`. This file replicates the public surface
 * we use so the bare import resolves.
 */
declare module "tinykeys" {
    export type KeyBindingPress = [mods: string[], key: string | RegExp];

    export interface KeyBindingMap {
        [keybinding: string]: (event: KeyboardEvent) => void;
    }

    export interface KeyBindingHandlerOptions {
        timeout?: number;
    }

    export interface KeyBindingOptions extends KeyBindingHandlerOptions {
        event?: "keydown" | "keyup";
        capture?: boolean;
    }

    export function parseKeybinding(str: string): KeyBindingPress[];
    export function matchKeyBindingPress(
        event: KeyboardEvent,
        press: KeyBindingPress,
    ): boolean;
    export function createKeybindingsHandler(
        keyBindingMap: KeyBindingMap,
        options?: KeyBindingHandlerOptions,
    ): EventListener;
    export function tinykeys(
        target: Window | HTMLElement,
        keyBindingMap: KeyBindingMap,
        options?: KeyBindingOptions,
    ): () => void;
}
