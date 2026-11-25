export * from './types.js';
export * from './table-service.js';
export interface TableConverterCommandProps {
    featureCode?: string;
    initialRawText?: string;
    initialHeaderMode?: 'first-row-header' | 'no-header';
    initialSqlTableName?: string;
}
export declare function TableConverterCommand(props?: TableConverterCommandProps): JSX.Element;
export default TableConverterCommand;
