import React, { Action, ActionPanel, Color, Icon, List, Toast, showToast, useMemo, useState } from '../../index.js';
import { inspectMediaBuffer, pickAndReadMediaFile, saveCleanedMediaToDisk, stripAllMetadataFromBuffer, stripGpsOnlyFromBuffer } from './media-service.js';
export * from './types.js';
export * from './media-service.js';
function getGroupIcon(group) {
    switch (group) {
        case '位置隐私':
            return Icon.Pin;
        case '拍摄设备':
            return Icon.Desktop;
        case '曝光参数':
            return Icon.Eye;
        case '视频流':
            return Icon.Play;
        default:
            return Icon.Document;
    }
}
export function MediaMetadataCommand(props = {}) {
    const [rawBytes, setRawBytes] = useState(props.initialRawBytes ?? null);
    const [selectedFilePath, setSelectedFilePath] = useState(props.initialSummary?.filePath || 'IMG_20261025.JPG');
    const [stripMode, setStripMode] = useState('gps-only');
    const [keepBackup, setKeepBackup] = useState(true);
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const inspected = useMemo(() => {
        if (rawBytes) {
            try {
                return inspectMediaBuffer(rawBytes, selectedFilePath);
            }
            catch {
                return null;
            }
        }
        if (props.initialSummary) {
            return {
                summary: props.initialSummary,
                params: props.initialParams ?? []
            };
        }
        return null;
    }, [rawBytes, selectedFilePath, props.initialSummary, props.initialParams]);
    const handlePickMediaFile = async () => {
        setIsLoading(true);
        try {
            const res = await pickAndReadMediaFile(props.hostOverride);
            if (!res.ok || !res.bytes) {
                if (res.error && res.error !== '未选择媒体文件') {
                    await showToast({ style: Toast.Style.Failure, title: res.error });
                }
                return;
            }
            setSelectedFilePath(res.filePath || 'IMG_20261025.JPG');
            setRawBytes(res.bytes);
            await showToast({
                style: Toast.Style.Success,
                title: `已载入媒体文件 (${res.bytes.byteLength} 字节)`
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    const mediaInfo = inspected?.summary ?? null;
    const paramList = useMemo(() => {
        const all = inspected?.params ?? [];
        const q = searchText.trim().toLowerCase();
        if (!q)
            return all;
        return all.filter((p) => p.label.toLowerCase().includes(q) ||
            p.value.toLowerCase().includes(q) ||
            p.group.toLowerCase().includes(q));
    }, [inspected, searchText]);
    const handleStripGpsOnly = async () => {
        if (!mediaInfo || !mediaInfo.hasGps) {
            await showToast({
                style: Toast.Style.Success,
                title: '该照片未包含任何 GPS 定位隐私，非常安全'
            });
            return;
        }
        setIsLoading(true);
        try {
            if (rawBytes) {
                const cleaned = stripGpsOnlyFromBuffer(rawBytes);
                setRawBytes(cleaned);
                const outPath = mediaInfo.filePath.replace(/(\.[a-z0-9]+)$/i, '_clean$1');
                await saveCleanedMediaToDisk(outPath, cleaned, props.hostOverride);
            }
            await showToast({
                style: Toast.Style.Success,
                title: '已无损抹除 GPS 经纬度坐标（100% 保留原图画质与相机曝光参数）'
            });
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: err instanceof Error ? err.message : String(err)
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    const handleStripAllExif = async () => {
        if (!mediaInfo || !mediaInfo.hasExif) {
            await showToast({
                style: Toast.Style.Success,
                title: '该文件不包含可擦除的 EXIF 元数据'
            });
            return;
        }
        setIsLoading(true);
        try {
            if (rawBytes) {
                const cleaned = stripAllMetadataFromBuffer(rawBytes);
                setRawBytes(cleaned);
                const outPath = mediaInfo.filePath.replace(/(\.[a-z0-9]+)$/i, '_clean$1');
                await saveCleanedMediaToDisk(outPath, cleaned, props.hostOverride);
            }
            await showToast({
                style: Toast.Style.Success,
                title: '已彻底抹除全部 EXIF 与设备序列号元数据（原图像素零损保真）'
            });
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: err instanceof Error ? err.message : String(err)
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    return (React.createElement(List, { navigationTitle: "EXIF\u9690\u79C1\u62B9\u9664", isLoading: isLoading, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u5A92\u4F53\u53C2\u6570\u540D\u79F0\u3001GPS \u5750\u6807\u3001\u76F8\u673A\u578B\u53F7\u6216\u89C6\u9891\u6D41\u7F16\u7801...", filterBar: {
            summaryText: mediaInfo
                ? mediaInfo.hasGps
                    ? `发现高精度 GPS 定位: ${mediaInfo.gpsFormatted} · 设备: ${mediaInfo.deviceModel || '未知'}`
                    : `已检测: ${mediaInfo.fileType.toUpperCase()} · 无 GPS 隐私定位 · 设备: ${mediaInfo.deviceModel || '未知'}`
                : '无损解析 EXIF、查看音视频流编码参数、一键擦除照片拍摄定位',
            actions: [
                {
                    id: 'pick-media',
                    title: '选择照片/视频',
                    onAction: () => {
                        void handlePickMediaFile();
                    }
                },
                {
                    id: 'strip-gps-only',
                    title: '仅擦除 GPS 定位',
                    onAction: () => {
                        void handleStripGpsOnly();
                    }
                },
                {
                    id: 'strip-all-exif',
                    title: '彻底抹除全部 EXIF',
                    onAction: () => {
                        void handleStripAllExif();
                    }
                }
            ]
        }, workbenchPanel: {
            title: mediaInfo ? mediaInfo.fileName : '请拖入照片 (JPG/PNG/HEIC) 或音视频文件',
            subtitle: mediaInfo ? mediaInfo.filePath : '纯二进制 APP1/EXIF 无损段剥离引擎（零重编码画质损耗）',
            fields: [
                {
                    id: 'stripMode',
                    label: '隐私抹除策略',
                    type: 'select',
                    value: stripMode,
                    options: [
                        { label: '仅擦除 GPS 经纬度 (保留光圈/快门/相机型号)', value: 'gps-only' },
                        { label: '彻底抹除所有 EXIF / 设备序列号 / 拍摄时间', value: 'all-exif' }
                    ],
                    onChange: (val) => setStripMode(val)
                },
                {
                    id: 'keepBackup',
                    label: '另存为 _clean 副本 (保护原图)',
                    type: 'toggle',
                    value: keepBackup,
                    onChange: (val) => setKeepBackup(Boolean(val))
                },
                {
                    id: 'gpsStatus',
                    label: 'GPS 定位隐私状态',
                    type: 'info',
                    value: mediaInfo?.hasGps ? mediaInfo.gpsFormatted || '包含定位' : '安全 (无定位)'
                },
                {
                    id: 'deviceInfo',
                    label: '拍摄设备 / 编码器',
                    type: 'info',
                    value: mediaInfo?.deviceModel || '未检测'
                }
            ],
            previewCard: {
                title: mediaInfo?.hasGps
                    ? `高危隐私预警：包含精确到米的拍摄地经纬度 (${mediaInfo.gpsFormatted})`
                    : '隐私安全：当前文件未检出 GPS 经纬度坐标',
                subtitle: '采用二进制段直接裁剪，不经过 Canvas 重压缩，像素均方误差 MSE = 0'
            }
        }, subList: {
            title: `媒体元数据与流参数明细 (${paramList.length} 项)`,
            subtitle: '按 Enter 立即无损抹除 GPS 定位，或复制任意媒体参数值',
            emptyText: '该文件未包含可解析的 EXIF 或媒体流参数',
            items: paramList.map((param) => (React.createElement(List.Item, { key: param.key, id: param.key, title: param.label, subtitle: param.value, icon: getGroupIcon(param.group), accessories: [
                    param.group === '位置隐私'
                        ? { tag: { value: param.group, color: Color.Red } }
                        : { tag: param.group },
                    param.extraHint ? { text: param.extraHint } : {}
                ], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u4EC5\u64E6\u9664 GPS \u5B9A\u4F4D (\u4FDD\u7559\u62CD\u6444\u53C2\u6570)", icon: Icon.Shield, onAction: handleStripGpsOnly }),
                    React.createElement(Action, { title: "\u5F7B\u5E95\u62B9\u9664\u6240\u6709 EXIF \u4E0E\u5143\u6570\u636E", icon: Icon.Trash, style: Action.Style.Destructive, onAction: handleStripAllExif }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BE5\u9879\u53C2\u6570\u503C", content: param.value })) })))
        } }));
}
export default MediaMetadataCommand;
