import type { Quicklink } from './types.js';
export * from './types.js';
export * from './quicklinks-storage.js';
export declare function CreateQuicklinkForm({ onCreated }: {
    onCreated?: (item: Quicklink) => void;
}): JSX.Element;
export declare function EditQuicklinkForm({ item, onUpdated }: {
    item: Quicklink;
    onUpdated?: (updated: Quicklink) => void;
}): JSX.Element;
export declare function ImportQuicklinksForm({ onImported }: {
    onImported?: (items: Quicklink[]) => void;
}): JSX.Element;
export interface QuicklinksCommandProps {
    featureCode?: string;
    initialLinks?: Quicklink[];
}
export declare function QuicklinksCommand(props?: QuicklinksCommandProps): JSX.Element;
export default QuicklinksCommand;
