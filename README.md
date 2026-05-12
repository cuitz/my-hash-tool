# 哈希计算器

> 一个用于 ZTools 的文件/字符串哈希计算插件。

## 功能

- 计算字符串的 MD5 / SHA1 / SHA256
- 计算文件的 MD5 / SHA1 / SHA256
- 支持拖入文件或点击选择文件
- 支持多文件串行计算
- 每个文件显示独立进度条
- 支持复制单个 Hash 结果
- 大文件计算前提醒
- 可在设置中开启/关闭提醒并自定义阈值

## 开发

```bash
npm install
npm run dev
```

ZTools 开发模式会读取 `public/plugin.json` 中的 `development.main`。

## 构建

```bash
npm run build
```

构建产物输出到 `dist/`。

## 打包

```bash
npm run package
```

打包脚本会先执行构建，再生成 `my-hash-tool-v1.0.0.zip`。安装包根目录会直接包含 `plugin.json`。

## 设计文档

见 [DESIGN.md](./DESIGN.md)。
