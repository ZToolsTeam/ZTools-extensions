import { ListProps, ListItemProps, ListSectionProps, ListDropdownProps, ListDropdownItemProps, ListDropdownSectionProps, ViewDescriptor } from "./types.js";
export interface ListDropdownComponent {
    (props?: ListDropdownProps, ...children: any[]): ViewDescriptor<ListDropdownProps>;
    Item: (props: ListDropdownItemProps) => ViewDescriptor<ListDropdownItemProps>;
    Section: (props?: ListDropdownSectionProps, ...children: any[]) => ViewDescriptor<ListDropdownSectionProps>;
}
export interface ListItemComponent {
    (props: ListItemProps): ViewDescriptor<ListItemProps>;
    Detail: any;
}
export interface ListComponent {
    (props?: ListProps, ...children: any[]): ViewDescriptor<ListProps>;
    Item: ListItemComponent;
    Section: (props?: ListSectionProps, ...children: any[]) => ViewDescriptor<ListSectionProps>;
    Dropdown: ListDropdownComponent;
}
/**
 * List 顶层列表容器
 */
export declare const List: ListComponent;
