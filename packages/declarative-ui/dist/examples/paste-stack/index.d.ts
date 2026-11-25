import type { StackItem } from './types.js';
export * from './types.js';
export * from './stack-manager.js';
export interface PasteStackProps {
    featureCode?: string;
    initialItems?: StackItem[];
    initialListening?: boolean;
    hostOverride?: unknown;
}
export declare function PasteStack({ featureCode, initialItems, initialListening, hostOverride }?: PasteStackProps): JSX.Element;
export declare const PasteStackCommand: typeof PasteStack;
export default PasteStack;
