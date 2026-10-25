import { ActionProps, ActionCopyToClipboardProps, ActionPasteProps, ActionOpenInBrowserProps, ActionOpenWithProps, ActionShowInFinderProps, ActionPushProps, ActionSubmitFormProps, ActionPanelProps, ActionPanelSectionProps, ActionPanelSubmenuProps, ViewDescriptor } from "./types.js";
export interface ActionComponent {
    (props: ActionProps): ViewDescriptor<ActionProps>;
    Style: {
        readonly Regular: "regular";
        readonly Destructive: "destructive";
    };
    CopyToClipboard: (props: ActionCopyToClipboardProps) => ViewDescriptor<ActionCopyToClipboardProps>;
    Paste: (props: ActionPasteProps) => ViewDescriptor<ActionPasteProps>;
    OpenInBrowser: (props: ActionOpenInBrowserProps) => ViewDescriptor<ActionOpenInBrowserProps>;
    OpenWith: (props: ActionOpenWithProps) => ViewDescriptor<ActionOpenWithProps>;
    ShowInFinder: (props: ActionShowInFinderProps) => ViewDescriptor<ActionShowInFinderProps>;
    Push: (props: ActionPushProps) => ViewDescriptor<ActionPushProps>;
    SubmitForm: (props: ActionSubmitFormProps) => ViewDescriptor<ActionSubmitFormProps>;
    Open: (props: any) => ViewDescriptor<any>;
}
export interface ActionPanelComponent {
    (props?: ActionPanelProps, ...children: any[]): ViewDescriptor<ActionPanelProps>;
    Section: (props?: ActionPanelSectionProps, ...children: any[]) => ViewDescriptor<ActionPanelSectionProps>;
    Submenu: (props: ActionPanelSubmenuProps, ...children: any[]) => ViewDescriptor<ActionPanelSubmenuProps>;
}
/**
 * Action 基础声明式组件
 */
export declare const Action: ActionComponent;
/**
 * ActionPanel 容器组件
 */
export declare const ActionPanel: ActionPanelComponent;
