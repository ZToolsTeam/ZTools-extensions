/**
 * ZTools 图片轻量编辑与批注业务逻辑 (纯函数与声明式数据模型)
 */

export type WatermarkPosition =
  | "tiled"
  | "center"
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  position: WatermarkPosition;
  rotation?: number;
}

export interface EditorImage {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  dataUrl: string;
}

export interface EditorState {
  sourceImage: EditorImage;
  scale: number; // 0.25 - 2.0
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  watermark: WatermarkOptions;
}

export interface EditorResult {
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  scale: number;
  rotation: number;
  flipSummary: string;
  watermark: WatermarkOptions;
  watermarkSummary: string;
  sourceName: string;
  previewDataUrl: string;
  svgSource: string;
  estimatedBytes: number;
  formattedSize: string;
  markdownSnippet: string;
}

// -------------------------------------------------------------
// 1. 内置项目样张与底图 (高保真矢量自包含)
// -------------------------------------------------------------

const CONTRACT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <rect width="800" height="600" fill="#f8fafc"/>
  <rect x="50" y="40" width="700" height="520" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
  <!-- Header -->
  <rect x="90" y="80" width="220" height="32" rx="6" fill="#3b82f6"/>
  <text x="200" y="102" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle">商业合作保密协议</text>
  <text x="710" y="100" font-family="monospace" font-size="14" fill="#64748b" text-anchor="end">DOC-2026-X99</text>
  <!-- Lines -->
  <line x1="90" y1="130" x2="710" y2="130" stroke="#e2e8f0" stroke-width="2"/>
  <rect x="90" y="160" width="620" height="14" rx="4" fill="#e2e8f0"/>
  <rect x="90" y="190" width="580" height="14" rx="4" fill="#e2e8f0"/>
  <rect x="90" y="220" width="540" height="14" rx="4" fill="#e2e8f0"/>
  <rect x="90" y="250" width="600" height="14" rx="4" fill="#e2e8f0"/>
  <!-- Key term box -->
  <rect x="90" y="290" width="620" height="90" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-dasharray="6 4"/>
  <text x="110" y="325" font-family="system-ui, sans-serif" font-size="15" font-weight="bold" fill="#334155">第一条：双方应对商业情报、架构设计及源码完全保密。</text>
  <text x="110" y="355" font-family="system-ui, sans-serif" font-size="14" fill="#64748b">未经书面许可，任何一方不得向第三方泄露本协议涉及之任何技术资产。</text>
  <!-- Stamp placeholder -->
  <circle cx="630" cy="460" r="50" fill="none" stroke="#ef4444" stroke-width="4" stroke-dasharray="4 2" opacity="0.8"/>
  <text x="630" y="466" font-family="system-ui, sans-serif" font-size="15" font-weight="bold" fill="#ef4444" text-anchor="middle" opacity="0.8">机密盖印区</text>
</svg>`;

const BLUEPRINT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
  <rect width="800" height="500" fill="#0f172a"/>
  <!-- Grid lines -->
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="800" height="500" fill="url(#grid)"/>
  <!-- Architecture boxes -->
  <rect x="80" y="140" width="180" height="220" rx="12" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
  <text x="170" y="175" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#38bdf8" text-anchor="middle">客户端轻量宿主</text>
  <text x="170" y="210" font-family="monospace" font-size="13" fill="#94a3b8" text-anchor="middle">Electron + Vue3</text>
  
  <path d="M260 250 L360 250" stroke="#38bdf8" stroke-width="3" stroke-dasharray="6 4"/>
  
  <rect x="360" y="140" width="180" height="220" rx="12" fill="#1e293b" stroke="#a855f7" stroke-width="2"/>
  <text x="450" y="175" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#a855f7" text-anchor="middle">声明式运行时</text>
  <text x="450" y="210" font-family="monospace" font-size="13" fill="#94a3b8" text-anchor="middle">Raycast Compat</text>

  <path d="M540 250 L640 250" stroke="#a855f7" stroke-width="3" stroke-dasharray="6 4"/>

  <rect x="640" y="140" width="120" height="220" rx="12" fill="#1e293b" stroke="#10b981" stroke-width="2"/>
  <text x="700" y="175" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#10b981" text-anchor="middle">Native</text>
  <text x="700" y="210" font-family="monospace" font-size="13" fill="#94a3b8" text-anchor="middle">Rust Sidecar</text>

  <text x="400" y="60" font-family="system-ui, sans-serif" font-size="22" font-weight="bold" fill="#f8fafc" text-anchor="middle">ZTools 现代架构拓扑蓝图</text>
</svg>`;

const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
  <defs>
    <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="70%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#fdba74"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#skyGrad)"/>
  <circle cx="500" cy="140" r="45" fill="#fef08a"/>
  <!-- Mountain layer -->
  <polygon points="-40,480 180,260 400,480" fill="#047857"/>
  <polygon points="160,480 380,220 600,480" fill="#065f46"/>
  <polygon points="340,480 520,300 700,480" fill="#047857"/>
  <rect x="0" y="440" width="640" height="40" fill="#064e3b"/>
  <text x="32" y="465" font-family="sans-serif" font-size="15" fill="#ffffff">风景样张 (Sample Landscape 640×480)</text>
</svg>`;

export const SAMPLE_IMAGES: EditorImage[] = [
  {
    id: "sample-contract",
    name: "保密合同草案 (Contract)",
    description: "800 × 600 高价值商务文档，适合添加斜向防伪水印",
    width: 800,
    height: 600,
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(CONTRACT_SVG)}`
  },
  {
    id: "sample-blueprint",
    name: "技术架构蓝图 (Blueprint)",
    description: "800 × 500 研发拓扑图，适合缩放与团队版权批注",
    width: 800,
    height: 500,
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(BLUEPRINT_SVG)}`
  },
  {
    id: "sample-photo",
    name: "自然风景样张 (Photo)",
    description: "640 × 480 户外原图，适合测试旋转翻转与画质缩放",
    width: 640,
    height: 480,
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(PHOTO_SVG)}`
  }
];

export const DEFAULT_EDITOR_STATE: EditorState = {
  sourceImage: SAMPLE_IMAGES[0],
  scale: 1.0,
  rotation: 0,
  flipH: false,
  flipV: false,
  watermark: {
    text: "机密文件 严禁外传",
    fontSize: 32,
    color: "#ef4444",
    opacity: 0.35,
    position: "tiled",
    rotation: -30
  }
};

// -------------------------------------------------------------
// 2. 纯声明式 SVG 图像组合渲染引擎 (无 DOM / 零 CSS 污染)
// -------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderEditedImage(state: EditorState): EditorResult {
  const { sourceImage, scale, rotation, flipH, flipV, watermark } = state;
  const isRotated90 = rotation === 90 || rotation === 270;

  // 计算旋转与缩放后的画布容器外包围盒
  const boxWidth = isRotated90 ? sourceImage.height : sourceImage.width;
  const boxHeight = isRotated90 ? sourceImage.width : sourceImage.height;

  const targetWidth = Math.max(1, Math.round(boxWidth * scale));
  const targetHeight = Math.max(1, Math.round(boxHeight * scale));

  // 变换原点与矩阵计算
  const cx = targetWidth / 2;
  const cy = targetHeight / 2;
  const scaleX = (flipH ? -1 : 1) * scale;
  const scaleY = (flipV ? -1 : 1) * scale;

  // 组装图片图层变换
  const imageTransform = `translate(${cx}, ${cy}) rotate(${rotation}) scale(${scaleX}, ${scaleY}) translate(${-sourceImage.width / 2}, ${-sourceImage.height / 2})`;

  // 生成水印图层 XML
  let watermarkXml = "";
  const escapedText = escapeXml(watermark.text || "");
  const wmColor = watermark.color || "#ef4444";
  const wmOpacity = watermark.opacity ?? 0.35;
  const wmSize = Math.max(12, Math.round(watermark.fontSize * scale));

  if (escapedText.trim()) {
    switch (watermark.position) {
      case "tiled": {
        // 斜向满铺重复水印
        const patternW = Math.max(180, wmSize * 8);
        const patternH = Math.max(100, wmSize * 4);
        watermarkXml = `
          <defs>
            <pattern id="wmTiled" width="${patternW}" height="${patternH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
              <text x="${patternW / 2}" y="${patternH / 2}" font-family="system-ui, sans-serif" font-size="${wmSize}" font-weight="bold" fill="${wmColor}" fill-opacity="${wmOpacity}" text-anchor="middle" dominant-baseline="middle">${escapedText}</text>
            </pattern>
          </defs>
          <rect width="${targetWidth}" height="${targetHeight}" fill="url(#wmTiled)"/>
        `;
        break;
      }
      case "center": {
        watermarkXml = `
          <text x="${cx}" y="${cy}" transform="rotate(-25, ${cx}, ${cy})" font-family="system-ui, sans-serif" font-size="${wmSize * 1.3}" font-weight="bold" fill="${wmColor}" fill-opacity="${wmOpacity}" text-anchor="middle" dominant-baseline="middle">${escapedText}</text>
        `;
        break;
      }
      case "bottom-right": {
        watermarkXml = `
          <g transform="translate(${targetWidth - 20}, ${targetHeight - 20})">
            <text x="0" y="0" font-family="system-ui, sans-serif" font-size="${wmSize}" font-weight="bold" fill="${wmColor}" fill-opacity="${wmOpacity}" text-anchor="end">${escapedText}</text>
          </g>
        `;
        break;
      }
      case "bottom-left": {
        watermarkXml = `
          <g transform="translate(20, ${targetHeight - 20})">
            <text x="0" y="0" font-family="system-ui, sans-serif" font-size="${wmSize}" font-weight="bold" fill="${wmColor}" fill-opacity="${wmOpacity}" text-anchor="start">${escapedText}</text>
          </g>
        `;
        break;
      }
      case "top-right": {
        watermarkXml = `
          <g transform="translate(${targetWidth - 20}, ${wmSize + 20})">
            <text x="0" y="0" font-family="system-ui, sans-serif" font-size="${wmSize}" font-weight="bold" fill="${wmColor}" fill-opacity="${wmOpacity}" text-anchor="end">${escapedText}</text>
          </g>
        `;
        break;
      }
      case "top-left": {
        watermarkXml = `
          <g transform="translate(20, ${wmSize + 20})">
            <text x="0" y="0" font-family="system-ui, sans-serif" font-size="${wmSize}" font-weight="bold" fill="${wmColor}" fill-opacity="${wmOpacity}" text-anchor="start">${escapedText}</text>
          </g>
        `;
        break;
      }
    }
  }

  // 拼接整体声明式 SVG
  const svgSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${targetWidth} ${targetHeight}" width="${targetWidth}" height="${targetHeight}">
    <rect width="${targetWidth}" height="${targetHeight}" fill="#ffffff"/>
    <g transform="${imageTransform}">
      <image href="${sourceImage.dataUrl}" width="${sourceImage.width}" height="${sourceImage.height}"/>
    </g>
    ${watermarkXml}
    <!-- Status badge in preview -->
    <g transform="translate(12, ${targetHeight - 28})">
      <rect width="210" height="22" rx="4" fill="#000000" opacity="0.6"/>
      <text x="105" y="15" font-family="monospace" font-size="11" fill="#38bdf8" text-anchor="middle">${targetWidth}×${targetHeight} | ${rotation}° | ${Math.round(scale * 100)}%</text>
    </g>
  </svg>`;

  const previewDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgSource)}`;
  const estimatedBytes = svgSource.length;
  const formattedSize =
    estimatedBytes < 1024
      ? `${estimatedBytes} B`
      : `${(estimatedBytes / 1024).toFixed(1)} KB`;

  const flipParts: string[] = [];
  if (flipH) flipParts.push("水平镜像");
  if (flipV) flipParts.push("垂直镜像");
  const flipSummary = flipParts.length > 0 ? flipParts.join(" + ") : "无镜像";

  const posLabelMap: Record<WatermarkPosition, string> = {
    tiled: "斜向满铺",
    center: "居中突出",
    "bottom-right": "右下角",
    "bottom-left": "左下角",
    "top-right": "右上角",
    "top-left": "左上角"
  };

  const watermarkSummary = watermark.text
    ? `"${watermark.text}" (${posLabelMap[watermark.position]}, ${Math.round(watermark.opacity * 100)}%)`
    : "未添加水印";

  return {
    width: targetWidth,
    height: targetHeight,
    originalWidth: sourceImage.width,
    originalHeight: sourceImage.height,
    scale,
    rotation,
    flipSummary,
    watermark,
    watermarkSummary,
    sourceName: sourceImage.name,
    previewDataUrl,
    svgSource,
    estimatedBytes,
    formattedSize,
    markdownSnippet: `![编辑导出图](${previewDataUrl})`
  };
}

// -------------------------------------------------------------
// 3. 状态转换纯函数 (Action Reducers)
// -------------------------------------------------------------

export function rotateClockwise(state: EditorState): EditorState {
  const nextRotation = ((state.rotation + 90) % 360) as 0 | 90 | 180 | 270;
  return { ...state, rotation: nextRotation };
}

export function rotateCounterClockwise(state: EditorState): EditorState {
  const nextRotation = ((state.rotation + 270) % 360) as 0 | 90 | 180 | 270;
  return { ...state, rotation: nextRotation };
}

export function toggleFlipH(state: EditorState): EditorState {
  return { ...state, flipH: !state.flipH };
}

export function toggleFlipV(state: EditorState): EditorState {
  return { ...state, flipV: !state.flipV };
}

export function updateScale(state: EditorState, scale: number): EditorState {
  const safeScale = Math.max(0.1, Math.min(3.0, scale));
  return { ...state, scale: safeScale };
}

export function updateWatermark(
  state: EditorState,
  partial: Partial<WatermarkOptions>
): EditorState {
  return {
    ...state,
    watermark: {
      ...state.watermark,
      ...partial
    }
  };
}

export function setSourceImage(state: EditorState, newImage: EditorImage): EditorState {
  return {
    ...state,
    sourceImage: newImage
  };
}

export function resetEditorState(state: EditorState): EditorState {
  return {
    ...DEFAULT_EDITOR_STATE,
    sourceImage: state.sourceImage
  };
}
