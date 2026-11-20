import { DetailProps, DetailMetadataProps, DetailMetadataLabelProps, DetailMetadataTagListProps, DetailMetadataTagListItemProps, DetailMetadataLinkProps, ViewDescriptor } from "./types.js";
/**
 * Detail 详情组件
 */
export declare function Detail(props?: DetailProps, ...children: any[]): ViewDescriptor<DetailProps>;
export declare namespace Detail {
    export { MetadataComponent as Metadata };
}
declare const MetadataComponent: {
    (props?: DetailMetadataProps, ...children: any[]): ViewDescriptor<DetailMetadataProps>;
    Label: (props: DetailMetadataLabelProps) => ViewDescriptor<DetailMetadataLabelProps>;
    TagList: typeof TagListComponent;
    Separator: () => ViewDescriptor;
    Link: (props: DetailMetadataLinkProps) => ViewDescriptor<DetailMetadataLinkProps>;
};
declare const TagListComponent: {
    (props: DetailMetadataTagListProps, ...children: any[]): ViewDescriptor<DetailMetadataTagListProps>;
    Item: (props: DetailMetadataTagListItemProps) => ViewDescriptor<DetailMetadataTagListItemProps>;
};
export {};
