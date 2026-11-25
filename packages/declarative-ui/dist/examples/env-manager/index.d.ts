import type { EnvItem } from './types.js';
export * from './types.js';
export * from './env-service.js';
export declare function EnvVarForm({ initialItem, onSaved }: {
    initialItem?: EnvItem;
    onSaved: (item: EnvItem) => void;
}): JSX.Element;
export interface EnvManagerCommandProps {
    featureCode?: string;
    initialItems?: EnvItem[];
    hostOverride?: unknown;
}
export declare function EnvManagerCommand(props?: EnvManagerCommandProps): JSX.Element;
export default EnvManagerCommand;
