import { createDescriptor } from "./factory.js";
const DropdownComponent = function FormDropdown(props, ...children) {
    return createDescriptor("Form.Dropdown", props, ...children);
};
DropdownComponent.Item = function FormDropdownItem(props) {
    return createDescriptor("Form.Dropdown.Item", props);
};
DropdownComponent.Section = function FormDropdownSection(props, ...children) {
    return createDescriptor("Form.Dropdown.Section", props, ...children);
};
/**
 * Form 表单声明式组件
 */
export const Form = function Form(props, ...children) {
    return createDescriptor("Form", props, ...children);
};
Form.TextField = function FormTextField(props) {
    return createDescriptor("Form.TextField", props);
};
Form.PasswordField = function FormPasswordField(props) {
    return createDescriptor("Form.PasswordField", props);
};
Form.TextArea = function FormTextArea(props) {
    return createDescriptor("Form.TextArea", props);
};
Form.Checkbox = function FormCheckbox(props) {
    return createDescriptor("Form.Checkbox", props);
};
Form.Dropdown = DropdownComponent;
Form.Description = function FormDescription(props) {
    return createDescriptor("Form.Description", props);
};
Form.Separator = function FormSeparator(props) {
    return createDescriptor("Form.Separator", props);
};
