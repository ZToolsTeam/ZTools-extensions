# 截图历史与回贴 (screenshot)

浏览本机截图目录，一键回贴、复制、定位与清理截图；可立即截取全部屏幕并复制到剪贴板

- **架构标准**：`@ztools/declarative-ui` 声明式 UI 视图描述符（布局三：左栏截取参数工作台 + 右栏截图队列）
- **截图来源**：宿主 `screenshots_scan` 扫描系统截图目录（macOS 桌面 / 自定义截图位置，Windows `Pictures/Screenshots` 等）
- **立即截取**：宿主 `screen_capture` 截取全部显示器（截取前自动隐藏 ZTools 窗口），文件保存在 ZTools 缓存目录，可选自动复制到剪贴板
- **目录授权**：宿主按窗口授权文件路径；复制、回贴、打开、定位与读取图片尺寸前，需在动作面板中「授权访问截图目录」（有效期 1 小时）。删除走宿主 `screenshots_delete`，只能删除扫描结果中的截图
- **文字识别 (OCR)**：仅 Windows（`OcrPlugin` DLL）提供，其他平台不显示 OCR 入口
- 不提供框选区域、标注与悬浮贴图
