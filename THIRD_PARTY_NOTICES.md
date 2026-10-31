# 第三方组件

本项目自行编写的代码目前未另行指定开源许可证；公开仓库不自动授予第三方再许可权。下列第三方组件遵循各自许可证，分发包保留相应许可文本。

| 组件 | 版本/来源 | 许可证 |
| --- | --- | --- |
| Node.js | 24.13.0 / https://nodejs.org/ | Node.js 发行版 LICENSE（含依赖通知） |
| PDF.js | pdfjs-dist 5.6.205 / https://github.com/mozilla/pdf.js | Apache-2.0；字体、解码器另见所附许可证 |
| pdf-lib | 1.17.1 / https://github.com/Hopding/pdf-lib | MIT |
| Tesseract.js | 7.0.0 / https://github.com/naptha/tesseract.js | Apache-2.0 |
| Tesseract.js core | 7.0.0 / https://github.com/naptha/tesseract.js-core | Apache-2.0 |
| English OCR model | https://github.com/tesseract-ocr/tessdata_fast | Apache-2.0 |

源码 `assets/eng.traineddata` 为英文 OCR 模型。便携包中 `app/node_modules/` 内各传递依赖的许可证随对应包保留，PDF 字体和解码器许可证保留在其资源子目录。

示例 PDF 为本项目脚本生成的虚构测试内容，不包含用户论文、实际芯片数据手册或私人文件。
