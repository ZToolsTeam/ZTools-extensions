import { createDescriptor } from "./factory.js";
import { Detail } from "./detail.js";
const DropdownComponent = function ListDropdown(props, ...children) {
    return createDescriptor("List.Dropdown", props, ...children);
};
DropdownComponent.Item = function ListDropdownItem(props) {
    return createDescriptor("List.Dropdown.Item", props);
};
DropdownComponent.Section = function ListDropdownSection(props, ...children) {
    return createDescriptor("List.Dropdown.Section", props, ...children);
};
import { normalizeDistributionBarProps, normalizeFilterBarProps } from "./segmented.js";
/**
 * List 顶层列表容器
 */
export const List = function List(props, ...children) {
    if (!props) {
        return createDescriptor("List", {}, ...children);
    }
    const normalized = { ...props };
    // 支持从 header 数组中自动提取 MetricGrid / DistributionBar / FilterBar / SegmentedControl
    if (Array.isArray(normalized.header)) {
        for (const node of normalized.header) {
            if (!node || typeof node !== "object")
                continue;
            if (node.type === "MetricGrid" && !normalized.metricGrid) {
                normalized.metricGrid = node;
            }
            else if (node.type === "DistributionBar" && !normalized.distributionBar) {
                normalized.distributionBar = node;
            }
            else if (node.type === "FilterBar" && !normalized.filterBar) {
                normalized.filterBar = node;
            }
            else if (node.type === "SegmentedControl" && !normalized.segmentedControl) {
                normalized.segmentedControl = node;
            }
        }
    }
    if (normalized.distributionBar && !normalized.distributionBar.$$typeof) {
        normalized.distributionBar = normalizeDistributionBarProps(normalized.distributionBar);
    }
    if (normalized.filterBar && !normalized.filterBar.$$typeof) {
        normalized.filterBar = normalizeFilterBarProps(normalized.filterBar);
    }
    return createDescriptor("List", normalized, ...children);
};
const ListItemComponent = function ListItem(props) {
    return createDescriptor("List.Item", props);
};
const ListItemDetailComponent = function ListItemDetail(props, ...children) {
    return createDescriptor("List.Item.Detail", props, ...children);
};
ListItemDetailComponent.Metadata = Detail.Metadata;
ListItemComponent.Detail = ListItemDetailComponent;
List.Item = ListItemComponent;
List.Section = function ListSection(props, ...children) {
    return createDescriptor("List.Section", props, ...children);
};
List.Dropdown = DropdownComponent;
