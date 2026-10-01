# AniMirror

本机运行的 VRM 面部动作工作室：导入角色，检查实际表情能力，映射与校准，再通过摄像头驱动头部和面部。

当前为 **V1 工程预览版**。核心功能已实现；真实人物动作成功率、成品动漫材质及 30 分钟持续运行等人工验收尚未完成，不能把诊断模型/模拟设备通过视作最终质量达标。实际记录见 [验收记录](docs/ACCEPTANCE.md)。

准备做最终测试时，从 [最终测试操作指南](docs/FINAL_TEST_GUIDE.md) 开始；指南包含逐步操作、通过标准、可复制记录表和本地RMS分析命令。

## 本机启动

先按下方“全新检出”步骤安装依赖并准备本地推理资源。完成后，也可以在项目目录的 PowerShell 中使用启动脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
```

打开 <http://127.0.0.1:5173>。脚本优先使用 PATH 中的 Node，也支持这台电脑现有的 Codex Node 运行时。退出服务用 Ctrl+C。

从 [AniMirror 仓库](https://github.com/epiconfuison/AniMirror) 全新检出启动：安装 Node.js 22.13+ 或 24，以及 pnpm 11.25.0，然后执行：

```powershell
pnpm install --frozen-lockfile
pnpm assets:setup
pnpm dev
```

首次检出时可先执行 `git clone https://github.com/epiconfuison/AniMirror.git`，再进入 `AniMirror` 目录。直接下载 GitHub ZIP 也能运行。项目早期使用 AR-Capture 名称；旧配置库、导出文件名与历史验收记录保留兼容。

初次安装需要网络。`assets:setup` 从已锁定的 MediaPipe 包复制 WASM 与 JS，并从 Google 官方地址下载固定版本模型、校验 SHA-256。生成资源约 25.2 MiB，其中模型约 3.6 MiB。运行期间只加载本地同源资源。下载失败可重试相同命令；损坏或版本不符会明确报错。二进制推理资源不存入 Git。

## 完整使用流程

1. 选择或拖入一个自包含完整人形 `.vrm`（0.x / 1.0；≤100 MB）。可先试 `tests/fixtures/diagnostic-vrm1-rich.vrm`。外部贴图引用、损坏结构和过大网格会被拒绝；替换失败保留原角色。
2. 查看模型能力报告。在“映射与调节”中点击试动，确认近似映射；未确认的近似映射不会驱动。左右指角色自身的左右，镜像视频不改变数据语义。目标缺失时不会生成形变。
3. 选择摄像头并主动开启。当前使用 **Worker CPU**，720p 请求、缩至宽 640 像素推理、最高 30 次/秒；只处理一张在途帧。实际吞吐取决于设备。
4. 依次采集中性脸、闭眼、张嘴、微笑，每步 3 秒；眉毛可选。样本不足或动作不清晰会提示重试。每步校准独立自动保存，换模型可复用；重采中性脸会重置动作幅度。
5. 调节映射权重、每通道增益/死区/曲线/上下限、头部范围与平滑。自然/增强仅改变已有表情强度。试动持续 1.5 秒，优先于实时驱动。
6. 点击“保存配置”保存模型与界面设置。再次导入同一文件时按 SHA-256 恢复；个人校准和模型配置分开保存。JSON 导入会检查版本、模型哈希和有效目标。模型文件本身不会持久保存。

暂停追踪保留摄像头连接；关闭摄像头停止所有轨道、Worker 和采集循环。遮挡或推理停滞时先短暂保持，再逐渐回正；恢复时渐变。浏览器权限被拒绝、设备占用或拔出时界面提供具体错误和重试入口。

## 诊断、回放和构建

展开“诊断与参数回放”查看渲染帧率、推理耗时、处理到渲染提交 P95 与具名系数。点击录制可采集最多 30 秒参数，支持导出/导入与固定 60 Hz 虚拟时钟确定性回放。这里不录制视频，也不是视频导出功能。

```powershell
pnpm test
pnpm test:e2e
pnpm build
pnpm test:e2e:build
pnpm preview
```

E2E 默认使用 Windows 已安装 Edge；其他位置设置 `EDGE_EXECUTABLE`。其他系统可 `pnpm exec playwright install chromium`。模拟摄像头测试验证 Worker/资源生命周期，不能替代真实摄像头质量评估。构建产物在 `dist/`；通过 HTTP 服务运行，不能直接双击 `index.html`。本机也可用 `scripts/dev.ps1 -Preview` 启动产物，端口 4173。

GitHub Actions 在 Linux 环境执行单元测试、生产构建和生产浏览器测试，安装与固定 Playwright 版本匹配的 Chromium，使用软件渲染和模拟摄像头。配置见 [.github/workflows/ci.yml](.github/workflows/ci.yml)，结果见 [Actions](https://github.com/epiconfuison/AniMirror/actions)。本机 Windows 默认仍使用 Edge；启动前必须完成 `assets:setup`。

## GitHub 测试上传

[上传审核与文件范围](docs/GITHUB_UPLOAD_REVIEW.md) 说明源码、测试素材和排除项。运行 `pnpm check:upload` 检查待发布文件；运行 `pnpm prepare:github` 生成独立源码目录及逐文件 SHA-256 清单，输出到 `.cache/github-upload/`。该步骤仅准备文件，不创建远程提交。

仅三份原创 CC0 诊断 VRM 随源码发布；自行导入的 VRM、推理二进制、缓存、个人参数和视频不进入测试源码包。源码整体的对外许可证尚未选定；诊断资产与第三方依赖分别按已有许可处理。

构建也可直接用 `node scripts/serve-build.mjs` 启动，不依赖 Vite 或其他 npm 运行包。`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1` 将构建及全部本地推理资源打包到 `.cache/releases/AR-Capture-v0.1.0-preview.zip`；解压后按 `START-HERE.txt` 操作，只需 Node。

无需摄像头体验参数链路：导入 `diagnostic-vrm1-rich.vrm`，再导入 `tests/fixtures/example-config.json`，在诊断面板导入 `synthetic-face-sequence.json` 并回放。该8秒片段是程序生成数据，包含左右眨眼、张嘴、三轴和2秒人脸丢失，不能作为识别质量证据。修改测试模型后可用 `node scripts/generate-examples.mjs` 重建对应哈希的示例。

## 数据和限制

- 摄像头图像在本机处理；模型、视频均不上传。IndexedDB 仅保存模型配置、默认个人校准和 UI 设置。“清除全部本地配置”会清除三类数据。
- 模型表情覆盖规则交给 three-vrm；仅支持已有 VRM 表情接口，原始 morph 名称用于检查，不另设双重写入。
- 视线仅使用已映射的视线表情；仅有眼骨、没有视线表情时不提供眼球驱动。视觉口型不是语音/音素识别。
- 目前以 Windows Chrome / Edge 为目标；已自动验证的是本机 Edge。无全身、手部、MMD、音频口型、虚拟摄像头、云端账号、AI 生成或付费 API。
- 这三份原创 CC0 模型用于诊断；真实动漫模型需要自行拥有合法使用权限。见 [模型说明](docs/MODEL_FIXTURES.md)。

## 开发记录

[项目计划](docs/PROJECT_PLAN.md) · [阶段目录](progress/README.md) · [第三方与 XR Animator 参考](docs/THIRD_PARTY.md) · [验收记录](docs/ACCEPTANCE.md)

每完成阶段创建 `progress/序号-阶段名/`，记录已完成内容、可复现验证、Git 提交及未完成验收。后续路线继续按计划保留，不以空按钮代替实现。
