import type { DownloadEntry } from './types.js';
export declare function AddCustomDownloadDirectoryForm(props: {
    customDirs: string[];
    onAdded: (dirPath: string) => void;
    onRemoved: (dirPath: string) => void;
}): JSX.Element;
export declare function DownloadFileDetailView({ entry }: {
    entry: DownloadEntry;
}): JSX.Element;
export default function DownloadsManagerCommand(props?: {
    launchContext?: {
        featureCode?: string;
    };
    featureCode?: string;
}): JSX.Element;
