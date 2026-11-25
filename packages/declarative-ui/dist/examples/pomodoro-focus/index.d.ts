import type { CountdownItem } from './types.js';
export * from './types.js';
export * from './pomodoro-service.js';
export declare function CountdownForm({ initialItem, onSave }: {
    initialItem?: CountdownItem;
    onSave: (item: CountdownItem) => void;
}): JSX.Element;
export interface PomodoroFocusCommandProps {
    featureCode?: string;
    initialCountdowns?: CountdownItem[];
    referenceDate?: string;
}
export declare function PomodoroFocusCommand(props?: PomodoroFocusCommandProps): JSX.Element;
export default PomodoroFocusCommand;
