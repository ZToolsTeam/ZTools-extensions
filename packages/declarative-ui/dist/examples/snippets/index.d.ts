import type { SnippetFormInput, SnippetItem } from './types.js';
export * from './types.js';
export * from './macro-engine.js';
export interface SnippetEditFormProps {
    initialData?: SnippetItem;
    onSave: (input: SnippetFormInput) => Promise<void>;
}
export declare function SnippetEditForm({ initialData, onSave }: SnippetEditFormProps): JSX.Element;
export interface SnippetsProps {
    featureCode?: string;
    initialSnippets?: SnippetItem[];
}
export declare function Snippets({ featureCode, initialSnippets }?: SnippetsProps): JSX.Element;
export declare const SnippetsCommand: typeof Snippets;
export default Snippets;
export declare function SnippetArgumentFormView({ snippet }: {
    snippet?: Record<string, unknown>;
}): JSX.Element;
export declare const CreateSnippetForm: typeof SnippetEditForm;
export declare function SnippetDetailView({ snippet }: {
    snippet?: Record<string, unknown>;
}): JSX.Element;
export { expandSnippetTemplate, filterSnippets, SAMPLE_SNIPPETS } from './macro-engine.js';
