import React, { Action, ActionPanel, Color, Icon, List, Toast, showToast, useEffect, useMemo, useState } from '../../index.js';
import { callHostTransport } from '../shared/native-ipc.js';
import { filterInstalledFonts, sanitizePreviewSampleText, scanInstalledFonts } from './font-service.js';
export * from './types.js';
export * from './font-service.js';
const SAMPLE_PRESETS = [
    '天地玄黄 宇宙洪荒 永和九年 岁在癸丑 12345 ABC abc',
    '限时特惠 全场五折 · 现代极客效率工作台 2026',
    'The quick brown fox jumps over the lazy dog 0123456789'
];
function resolveInitialLicenseFilter(featureCode, initialFilter) {
    if (initialFilter)
        return initialFilter;
    if (featureCode === 'font-manager-free-commercial')
        return 'free-commercial';
    if (featureCode === 'font-manager-commercial-risk')
        return 'commercial-risk';
    return 'all';
}
function getLicenseBadge(font) {
    if (font.licenseType === 'free-commercial') {
        return { tag: '免费商用' };
    }
    if (font.licenseType === 'commercial-risk') {
        return { tag: { value: '商用需授权', color: Color.Red } };
    }
    if (font.licenseType === 'system-builtin') {
        return { tag: '系统内置' };
    }
    return { tag: '需核实授权' };
}
export function FontManagerCommand(props = {}) {
    const [fonts, setFonts] = useState(props.initialFonts ?? []);
    const [licenseFilter, setLicenseFilter] = useState(() => resolveInitialLicenseFilter(props.featureCode, props.initialFilter));
    const [searchText, setSearchText] = useState('');
    const [sampleIdx, setSampleIdx] = useState(0);
    const [isLoading, setIsLoading] = useState(!props.initialFonts);
    const previewSampleText = useMemo(() => {
        if (props.initialSampleText) {
            return sanitizePreviewSampleText(props.initialSampleText);
        }
        return sanitizePreviewSampleText(SAMPLE_PRESETS[sampleIdx % SAMPLE_PRESETS.length]);
    }, [props.initialSampleText, sampleIdx]);
    const loadFonts = async () => {
        setIsLoading(true);
        try {
            const list = await scanInstalledFonts(props.hostOverride);
            setFonts(list);
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        setLicenseFilter(resolveInitialLicenseFilter(props.featureCode, props.initialFilter));
    }, [props.featureCode, props.initialFilter]);
    useEffect(() => {
        if (!props.initialFonts) {
            void loadFonts();
        }
    }, []);
    const filteredFonts = useMemo(() => filterInstalledFonts(fonts, licenseFilter, searchText), [fonts, licenseFilter, searchText]);
    const freeCount = useMemo(() => fonts.filter((f) => f.licenseType === 'free-commercial').length, [fonts]);
    const handleChangeSampleText = async () => {
        const nextIdx = (sampleIdx + 1) % SAMPLE_PRESETS.length;
        setSampleIdx(nextIdx);
        await showToast({
            style: Toast.Style.Success,
            title: `已切换预览文案：${SAMPLE_PRESETS[nextIdx].slice(0, 18)}...`
        });
    };
    const handleRevealFontFile = async (filePath) => {
        await callHostTransport('shell_show_item_in_folder', { path: filePath }, props.hostOverride);
    };
    return (React.createElement(List, { navigationTitle: "\u5B57\u4F53\u7BA1\u7406", isLoading: isLoading, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u5B57\u4F53\u540D\u79F0\u3001\u62FC\u97F3\uFF0C\u6216\u5207\u6362\u5546\u7528\u6388\u6743\u72B6\u6001...", searchBarAccessory: React.createElement(List.Dropdown, { value: licenseFilter, onChange: (val) => setLicenseFilter(val), tooltip: "\u6309\u5546\u7528\u6388\u6743\u72B6\u6001\u7B5B\u9009" },
            React.createElement(List.Dropdown.Item, { title: "\u5168\u90E8\u5DF2\u5B89\u88C5\u5B57\u4F53", value: "all", icon: Icon.Text }),
            React.createElement(List.Dropdown.Item, { title: "\u514D\u8D39\u53EF\u5546\u7528\u5B57\u4F53\uFF08\u5B89\u5168\u5408\u89C4\uFF09", value: "free-commercial", icon: Icon.Shield }),
            React.createElement(List.Dropdown.Item, { title: "\u5546\u4E1A\u7248\u6743\u5B57\u4F53\uFF08\u9700\u6388\u6743\u8D2D\u4E70\uFF09", value: "commercial-risk", icon: Icon.ExclamationMark }),
            React.createElement(List.Dropdown.Item, { title: "\u7CFB\u7EDF\u9ED8\u8BA4\u5185\u7F6E\u5B57\u4F53", value: "system", icon: Icon.Gear })), filterBar: {
            summaryText: `共发现 ${fonts.length} 款本机字体 · 其中 ${freeCount} 款免费可商用 · 当前预览: "${previewSampleText}"`,
            actions: [
                {
                    id: 'change-sample',
                    title: '切换预览样本词',
                    onAction: () => {
                        void handleChangeSampleText();
                    }
                },
                {
                    id: 'refresh-fonts',
                    title: '重新扫描字体库',
                    onAction: () => {
                        void loadFonts();
                    }
                }
            ]
        } }, filteredFonts.map((font) => (React.createElement(List.Item, { key: font.uniqueId, id: font.uniqueId, title: font.chineseName || font.family, subtitle: `${font.family} · ${previewSampleText}`, icon: Icon.Text, accessories: [
            getLicenseBadge(font),
            { text: font.format.toUpperCase() },
            { text: font.weight }
        ], actions: React.createElement(ActionPanel, null,
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5B57\u4F53 Family \u82F1\u6587\u540D", content: font.family }),
            React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236 CSS font-family \u58F0\u660E", content: `font-family: "${font.family}", "${font.chineseName || font.family}", sans-serif;`, shortcut: { modifiers: ['cmd'], key: 'enter' } }),
            React.createElement(Action, { title: "\u5728\u6587\u4EF6\u5939\u4E2D\u5B9A\u4F4D\u5B57\u4F53\u6587\u4EF6", icon: Icon.Folder, shortcut: { modifiers: ['cmd', 'shift'], key: 'o' }, onAction: () => handleRevealFontFile(font.filePath) }),
            font.licenseUrl ? (React.createElement(Action.OpenInBrowser, { title: "\u67E5\u770B\u5F00\u6E90\u5546\u7528\u4E3B\u9875 / \u8BB8\u53EF\u8BE6\u60C5", url: font.licenseUrl })) : null) })))));
}
export default FontManagerCommand;
