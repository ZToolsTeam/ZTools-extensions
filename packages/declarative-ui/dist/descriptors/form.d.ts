import { FormProps, FormTextFieldProps, FormTextAreaProps, FormCheckboxProps, FormDropdownProps, FormDropdownItemProps, FormDescriptionProps, FormPasswordFieldProps, ViewDescriptor } from "./types.js";
export interface FormDropdownComponent {
    (props: FormDropdownProps, ...children: any[]): ViewDescriptor<FormDropdownProps>;
    Item: (props: FormDropdownItemProps) => ViewDescriptor<FormDropdownItemProps>;
    /** 选项分组（宿主用 optgroup 显示） */
    Section: (props?: {
        title?: string;
    }, ...children: any[]) => ViewDescriptor<{
        title?: string;
    }>;
}
export interface FormComponent {
    (props?: FormProps, ...children: any[]): ViewDescriptor<FormProps>;
    TextField: (props: FormTextFieldProps) => ViewDescriptor<FormTextFieldProps>;
    PasswordField: (props: FormPasswordFieldProps) => ViewDescriptor<FormPasswordFieldProps>;
    TextArea: (props: FormTextAreaProps) => ViewDescriptor<FormTextAreaProps>;
    Checkbox: (props: FormCheckboxProps) => ViewDescriptor<FormCheckboxProps>;
    Dropdown: FormDropdownComponent;
    Description: (props: FormDescriptionProps) => ViewDescriptor<FormDescriptionProps>;
    Separator: (props?: Record<string, any>) => ViewDescriptor<Record<string, any>>;
}
/**
 * Form 表单声明式组件
 */
export declare const Form: FormComponent;
