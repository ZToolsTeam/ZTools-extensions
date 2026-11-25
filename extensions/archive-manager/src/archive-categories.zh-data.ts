/** 压缩包条目分类协议常量（UI 展示统一经 getCategoryLabel() 走 i18n） */
export const ARCHIVE_CATEGORY = Object.freeze({
  FOLDER: '文件夹',
  DOCS: '办公文档',
  MEDIA: '图片与媒体',
  CODE: '源码与配置',
  EXEC: '可执行程序',
  OTHER: '其他文件'
} as const)
