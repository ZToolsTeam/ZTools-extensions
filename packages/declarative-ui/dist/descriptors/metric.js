import { createDescriptor } from "./factory.js";
function normalizeMetricCard(item) {
    return {
        ...item,
        subValue: item.subValue ?? item.subtitle
    };
}
export function MetricCard(props) {
    return createDescriptor("MetricCard", normalizeMetricCard(props));
}
export function MetricGrid(props, ...children) {
    const normalizedProps = props
        ? {
            ...props,
            items: Array.isArray(props.items) ? props.items.map(normalizeMetricCard) : props.items
        }
        : props;
    return createDescriptor("MetricGrid", normalizedProps, ...children);
}
MetricGrid.Card = MetricCard;
