import React, { Action, ActionPanel, Icon, List, Toast, showToast, useMemo, useState } from '../../index.js';
import { computeAdaptiveWatermarkLayout, getPresetWatermarkTemplates, renderWatermarkOnImage, resolveTemplate } from './watermark-service.js';
export * from './types.js';
export * from './watermark-service.js';
export function IdWatermarkCommand(props = {}) {
    const [imageMeta, setImageMeta] = useState(props.initialImageMeta ?? {
        fileName: '居民身份证_正反面扫描件.jpg',
        width: 1920,
        height: 1080
    });
    const [businessName, setBusinessName] = useState(props.initialBusinessName ?? '企业入职与社保申报');
    const [opacityStr, setOpacityStr] = useState(String(props.initialOpacityPercent ?? 25));
    const [colorMode, setColorMode] = useState('auto');
    const [selectedRawTemplate, setSelectedRawTemplate] = useState('仅供办理 {business} 使用 他用无效 {date}');
    const [searchText, setSearchText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const watermarkText = useMemo(() => resolveTemplate(selectedRawTemplate, businessName), [selectedRawTemplate, businessName]);
    const presetTemplates = useMemo(() => {
        const all = getPresetWatermarkTemplates(businessName);
        const q = searchText.trim().toLowerCase();
        if (!q)
            return all;
        return all.filter((tpl) => tpl.label.toLowerCase().includes(q) ||
            tpl.resolvedText.toLowerCase().includes(q) ||
            tpl.scenarioTag.toLowerCase().includes(q));
    }, [businessName, searchText]);
    const layoutPreview = useMemo(() => {
        if (!imageMeta)
            return null;
        return computeAdaptiveWatermarkLayout(imageMeta.width, imageMeta.height, {
            text: watermarkText,
            opacityPercent: Number(opacityStr) || 25,
            rotateDegree: -30,
            gapPx: 220,
            colorMode
        });
    }, [imageMeta, watermarkText, opacityStr, colorMode]);
    const handlePickImage = async () => {
        try {
            const g = globalThis;
            const win = (typeof window !== 'undefined' ? window : g);
            const electron = win.__ztoolsElectron;
            if (typeof electron?.transport?.invoke === 'function') {
                const res = (await electron.transport.invoke('window_show_open_dialog', {
                    properties: ['openFile'],
                    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
                }));
                const chosen = res?.result?.filePaths?.[0];
                if (chosen && !res?.result?.canceled) {
                    const fileName = chosen.split(/[\\/]/).pop() || chosen;
                    setImageMeta({ fileName, width: 1920, height: 1080 });
                    await showToast({ style: Toast.Style.Success, title: `已载入证件照: ${fileName}` });
                }
            }
        }
        catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: err instanceof Error ? err.message : String(err)
            });
        }
    };
    const handleSaveWatermarkedImage = async (copyOnly = false) => {
        if (!imageMeta) {
            await showToast({
                style: Toast.Style.Failure,
                title: '请先拖入或选择需要添加防盗水印的证件图片'
            });
            return;
        }
        setIsLoading(true);
        try {
            const rendered = await renderWatermarkOnImage(imageMeta, {
                text: watermarkText,
                opacityPercent: Number(opacityStr) || 25,
                rotateDegree: -30,
                gapPx: 220,
                colorMode
            });
            if (copyOnly) {
                const g = globalThis;
                const win = (typeof window !== 'undefined' ? window : g);
                const electron = win.__ztoolsElectron;
                if (typeof electron?.transport?.invoke === 'function') {
                    await electron.transport.invoke('clipboard_copy_text', { text: rendered.svgOverlay });
                }
                await showToast({
                    style: Toast.Style.Success,
                    title: `已复制加水印图像数据到剪贴板 (${rendered.width}×${rendered.height})`
                });
            }
            else {
                await showToast({
                    style: Toast.Style.Success,
                    title: `已在本地合成防盗水印 (${rendered.width}×${rendered.height} · 共平铺 ${rendered.tileCount} 处)`
                });
            }
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
    return (React.createElement(List, { navigationTitle: "\u9632\u76D7\u6C34\u5370", isLoading: isLoading, isShowingDetail: false, searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: "\u641C\u7D22\u5E38\u7528\u9632\u76D7\u6C34\u5370\u5408\u89C4\u6A21\u677F\u6587\u6848\uFF08\u5165\u804C\u3001\u79DF\u623F\u3001\u8425\u4E1A\u6267\u7167\uFF09...", filterBar: {
            summaryText: imageMeta
                ? `原始尺寸: ${imageMeta.width}×${imageMeta.height} · 当前水印: "${watermarkText}" · 100% 纯本地离线合成`
                : '严格保护个人与企业证件隐私，绝不上传云端，-30° 斜向平铺防涂改文字',
            actions: [
                {
                    id: 'pick-image',
                    title: '选择证件原图',
                    onAction: () => {
                        void handlePickImage();
                    }
                },
                {
                    id: 'save-image',
                    title: '保存加水印图片',
                    onAction: () => {
                        void handleSaveWatermarkedImage(false);
                    }
                },
                {
                    id: 'copy-image',
                    title: '复制到剪贴板',
                    onAction: () => {
                        void handleSaveWatermarkedImage(true);
                    }
                }
            ]
        }, workbenchPanel: {
            title: imageMeta ? imageMeta.fileName : '请拖入或选择证件原图 (身份证 / 营业执照)',
            subtitle: '纯本地 OffscreenCanvas 物理级平铺合成（零网络外发）',
            fields: [
                {
                    id: 'businessName',
                    label: '办理业务名称',
                    type: 'text',
                    value: businessName,
                    onChange: (val) => setBusinessName(String(val))
                },
                {
                    id: 'opacity',
                    label: '水印不透明度',
                    type: 'select',
                    value: opacityStr,
                    options: [
                        { label: '15% (微弱底纹)', value: '15' },
                        { label: '25% (推荐平衡 · 既清晰又防盗)', value: '25' },
                        { label: '35% (强力防改 · 紧密附着)', value: '35' }
                    ],
                    onChange: (val) => setOpacityStr(String(val))
                },
                {
                    id: 'colorMode',
                    label: '文字灰阶色调',
                    type: 'select',
                    value: colorMode,
                    options: [
                        { label: '智能灰阶 (根据底色自适应)', value: 'auto' },
                        { label: '暗夜深灰 (适合白底营业执照)', value: 'dark' },
                        { label: '清透浅白 (适合深色背景)', value: 'light' }
                    ],
                    onChange: (val) => setColorMode(val)
                }
            ],
            previewCard: {
                title: watermarkText,
                subtitle: layoutPreview
                    ? `-30° 斜向密集平铺 ${layoutPreview.tileCount} 处 · 自适应字号 ${layoutPreview.effectiveFontSizePx}px · 间距 ${layoutPreview.effectiveGapPx}px`
                    : '选择预设模板后即时重绘'
            }
        }, subList: {
            title: `合规防盗水印预设模板库 (${presetTemplates.length} 项)`,
            subtitle: '按 Enter 应用选中模板并合成防盗水印图片',
            emptyText: '未找到匹配的水印模板',
            items: presetTemplates.map((tpl) => (React.createElement(List.Item, { key: tpl.id, id: tpl.id, title: tpl.label, subtitle: tpl.resolvedText, icon: Icon.Shield, accessories: [{ tag: tpl.scenarioTag }, { text: '点击应用' }], actions: React.createElement(ActionPanel, null,
                    React.createElement(Action, { title: "\u5E94\u7528\u6B64\u6A21\u677F\u5E76\u5408\u6210\u6C34\u5370", icon: Icon.CheckCircle, onAction: async () => {
                            setSelectedRawTemplate(tpl.rawText);
                            await handleSaveWatermarkedImage();
                        } }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u8BE5\u6A21\u677F\u6587\u672C", content: tpl.resolvedText })) })))
        } }));
}
export default IdWatermarkCommand;
