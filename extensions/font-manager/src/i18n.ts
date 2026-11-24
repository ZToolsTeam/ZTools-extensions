import { createTranslator } from "@ztools/declarative-ui";

const rawT = createTranslator(
  {
    "zh-CN": {
      upgradeClient: "请升级客户端后使用字体管理",
      invalidHostReply: "字体组件未返回有效结果",
      fontListFailed: "字体列表读取失败",
      fontPreviewFailed: "字体预览读取失败",
      revealUnconfirmed: "定位请求未确认",

      enterPreviewText: "请输入预览文字",
      defaultPreviewText: "天地玄黄 宇宙洪荒\nThe quick brown fox 0123456789",
      previewTooLong: "预览文字最多 160 个字符",
      previewControlChars: "预览文字含不支持的控制字符",
      fallbackFontsNote: "部分字形使用系统回退字体：{fonts}",
      listSep: "、",
      lastResortNote: "部分字符本机没有任何字体包含，显示为占位方框。",
      renderedBySelectedNote: "以上字形由所选字体绘制。",
      previewImageAlt: "所选字体的实际字形",

      fontReadFailed: "字体读取失败",
      formNavTitle: "设置预览文字",
      formSubmitTitle: "应用预览文字",
      formFieldTitle: "预览文字",
      formDescText: "最多 160 个字符；缺少字形时显示回退信息或字符覆盖提示。",
      notProvided: "未提供",
      licenseDefault: "字体文件未提供许可说明。",
      licenseDisclaimer: "仅反映字体文件内嵌元数据，商用前请以官方授权协议为准。",
      licenseMarkdown: "### 字体内嵌许可信息\n\n{license}\n\n### 版权信息\n\n{copyright}\n\n### 制造商\n\n{manufacturer}\n\n> 仅反映字体文件内嵌元数据，商用前请以官方授权协议为准。",
      licenseNavTitle: "字体许可信息",
      openLicenseUrlAction: "打开字体提供的许可链接",
      navTitle: "字体管理",
      searchPlaceholder: "搜索字体名称或样式",
      filterTooltip: "按字体信息筛选",
      filterAll: "全部字体",
      filterFavorites: "已收藏字体",
      filterWithLicense: "含内嵌许可信息",
      filterWithoutLicense: "未检出许可信息",
      filterSystem: "系统字体",
      summaryLoading: "正在读取系统字体…",
      summaryLoaded: "{total} 个字体样式 · 当前显示 {shown} 个",
      btnPreviewText: "设置预览文字",
      btnRescan: "重新扫描",
      renderingPreview: "正在绘制实际字形…",
      actionCopyFamily: "复制字体名称",
      actionCopyCss: "复制 CSS font-family",
      actionFavorite: "收藏字体",
      actionUnfavorite: "取消收藏",
      favoriteBadge: "已收藏",
      toastFavorited: "已收藏 {family}",
      toastUnfavorited: "已取消收藏 {family}",
      toastFavoriteFailed: "更新收藏状态失败",
      actionRevealFile: "定位字体文件",
      actionViewLicense: "查看许可信息"
    },
    "en-US": {
      upgradeClient: "Please upgrade ZTools to use Font Manager",
      invalidHostReply: "Font service did not return a valid result",
      fontListFailed: "Failed to load font list",
      fontPreviewFailed: "Failed to render font preview",
      revealUnconfirmed: "Reveal request was not confirmed",

      enterPreviewText: "Please enter preview text",
      defaultPreviewText: "The quick brown fox jumps over the lazy dog\n0123456789 !@#$%^&*()",
      previewTooLong: "Preview text cannot exceed 160 characters",
      previewControlChars: "Preview text contains unsupported control characters",
      fallbackFontsNote: "Some glyphs rendered with fallback font(s): {fonts}",
      listSep: ", ",
      lastResortNote: "Some characters are missing from all installed fonts and shown as tofu boxes.",
      renderedBySelectedNote: "All glyphs rendered by the selected font.",
      previewImageAlt: "Rendered font sample",

      fontReadFailed: "Failed to read fonts",
      formNavTitle: "Set Preview Text",
      formSubmitTitle: "Apply Preview Text",
      formFieldTitle: "Preview Text",
      formDescText: "Up to 160 characters; fallback fonts or missing glyphs will be noted.",
      notProvided: "Not provided",
      licenseDefault: "No license notice embedded in font file.",
      licenseDisclaimer: "Reflects embedded font file metadata only; please verify the official license agreement before commercial use.",
      licenseMarkdown: "### Embedded License Metadata\n\n{license}\n\n### Copyright\n\n{copyright}\n\n### Manufacturer\n\n{manufacturer}\n\n> Reflects embedded font file metadata only; please verify the official license agreement before commercial use.",
      licenseNavTitle: "Font License Info",
      openLicenseUrlAction: "Open License URL",
      navTitle: "Font Manager",
      searchPlaceholder: "Search font family or style",
      filterTooltip: "Filter by Font Info",
      filterAll: "All Fonts",
      filterFavorites: "Favorites",
      filterWithLicense: "Embedded License Metadata",
      filterWithoutLicense: "No License Metadata",
      filterSystem: "System Fonts",
      summaryLoading: "Loading system fonts...",
      summaryLoaded: "{total} font [[total:style|styles]] · Showing {shown}",
      btnPreviewText: "Set Preview Text",
      btnRescan: "Rescan",
      renderingPreview: "Rendering glyphs...",
      actionCopyFamily: "Copy Font Name",
      actionCopyCss: "Copy CSS font-family",
      actionFavorite: "Add to Favorites",
      actionUnfavorite: "Remove from Favorites",
      favoriteBadge: "Favorited",
      toastFavorited: "Favorited {family}",
      toastUnfavorited: "Removed {family} from favorites",
      toastFavoriteFailed: "Failed to update favorites",
      actionRevealFile: "Reveal Font File",
      actionViewLicense: "View License Info"
    }
  }
)
export const t: typeof rawT = (key, params) => {
  const out = rawT(key, params)
  if (!out.includes('[[')) return out
  return out.replace(/\[\[([A-Za-z0-9_.-]+):([^|\]]+)\|([^\]]+)\]\]/g, (_m, k: string, one: string, other: string) => {
    const v = params?.[k]
    const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''))
    return n === 1 ? one : other
  })
}
