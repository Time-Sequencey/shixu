# 时叙 · PDF 双语阅读助手

**时叙**是一款面向英文资料阅读的本地 PDF 双语助手。左侧保留英文原页，右侧显示中文译文；通过分栏、自然段和单元格识别，让电子器件数据手册中的引脚、参数和测试条件更便于对照阅读。

支持本地英文 OCR、DeepSeek API、电子专业版表格翻译，以及中文版和中英对照 PDF 导出。Windows 便携版完整解压后即可启动，无需安装运行环境。

## 直接使用

在本仓库的 [**Releases**](https://github.com/FANG-158/shixu/releases/latest) 下载 **时叙-v1.0.1-Windows64.zip**，完整解压后双击 **启动文档助手.cmd**。不需要安装 Node.js、Python 或 OCR 软件。请保持启动窗口开启，使用最新版 Edge 或 Chrome。不要直接双击 HTML 文件。

## 功能

- 支持文本 PDF，以及使用本地英文 OCR 识别的扫描 PDF。
- 双栏与自然段分块、自动字号、原位置表格单元格翻译。
- 开启“电子专业版”自动翻译当前页，包含表头、引脚说明和参数描述；数值、单位、符号列、引脚代号和独立公式保留原文。
- 图片保留原图；普通模式保留表格原图。
- 逐页或整份翻译，处理期间可翻页；支持选中英文临时查看中文。
- 导出中文版 PDF 和中英并排 PDF，命名为 `原文件名-中文版.pdf` 或 `原文件名-中英对照.pdf`。
- 支持用户自己的 DeepSeek API Key、账户余额及当前服务 token 用量查询；未配置时使用公共翻译服务。

## 从源码运行

需要 **Windows 10/11 x64、Node.js 24.13 或以上、Windows PowerShell 5.1 或以上**。

```powershell
npm ci --ignore-scripts
npm run setup
npm test
npm start
```

依赖安装需要联网。运行 `npm run setup` 后，PDF 渲染和英文 OCR 可离线工作。翻译和余额查询需要联网。源码和 Release 包均不包含 API Key；Key 只保存在当前服务内存中，退出服务后清除。翻译时文字会发送给所选择的外部翻译服务；DeepSeek 可能收费，公共服务可能限流。

## 开发检查与打包

```powershell
npm run selfcheck
npm run package
```

打包脚本使用当前 Node.js 可执行文件创建 Windows 64 位便携包，输出到 `dist/`。包内包含本地运行时、PDF 资源、OCR 英文模型和运行依赖。英文演示 PDF 为程序生成的虚构参数，不是实际产品规格。

## 限制

版面识别使用启发式规则；低清扫描、旋转表格、复杂无边框表格、行内公式和特殊字体可能识别不完整。只有识别到可靠表头和网格时才启用单元格翻译。关键电气参数应与左侧原文核对。

导出文件目前是图像 PDF，不包含可搜索的中文文字层。扫描 PDF 的原始字符识别错误不会自动得到保证修正。

完整操作说明见 [文档助手使用说明](app/文档助手使用说明.md)。第三方组件来源和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
