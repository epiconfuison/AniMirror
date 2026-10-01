# AniMirror

本机运行的 VRM 面部动作工作室：导入角色，检查实际表情能力，映射与校准，再通过摄像头驱动头部和面部。

当前为 **V1 工程预览版**。核心功能已实现；真实人物动作成功率、成品动漫材质及 30 分钟持续运行等人工验收尚未完成。自动化测试结果见 [GitHub Actions](https://github.com/epiconfuison/AniMirror/actions)。

## 首次使用

### 1. 准备环境

建议使用 Windows + 最新稳定版 Chrome / Edge，以及可用的摄像头。安装 [Node.js 24](https://nodejs.org/en/download) 后重新打开终端；项目最低要求 Node.js 22.13.0。在 PowerShell 中检查 Node，并安装固定版本的 pnpm：

```powershell
node --version
npm install -g pnpm@11.25.0
pnpm --version
```

### 2. 下载项目

已安装 Git 的用户执行：

```powershell
git clone https://github.com/epiconfuison/AniMirror.git
cd AniMirror
```

没有 Git 时，在 [仓库页面](https://github.com/epiconfuison/AniMirror) 点击 **Code → Download ZIP**。完整解压后，在含有 `package.json` 的文件夹中打开终端，例如 `AniMirror-main` 文件夹。

### 3. 安装依赖并启动

在项目根目录按顺序执行：

```powershell
pnpm install --frozen-lockfile
pnpm assets:setup
pnpm dev
```

首次安装需要联网访问 npm 依赖源及 Google 模型下载地址。`assets:setup` 从固定版本的 MediaPipe 包复制 JS / WASM，并下载固定版本的 Face Landmarker 模型、校验 SHA-256；资源约 25.2 MiB。下载失败时检查网络，重新执行 `pnpm assets:setup`，成功后再启动。运行期间加载本地同源推理资源。

保持终端运行，在浏览器中打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。若该端口被占用，以终端实际显示的地址为准，并在后续使用时保持同一地址。退出服务按 `Ctrl+C`。请通过本地 HTTP 服务访问应用，不要直接双击 `index.html`。

### 4. 导入角色并开启面捕

1. 点击“拖入你的角色”或拖入自己的 `.vrm` 文件，支持自包含的完整人形 VRM 0.x / 1.0，最大 100 MB。没有角色时，先选择仓库中的 `tests/fixtures/diagnostic-vrm1-rich.vrm`；它是简单几何诊断人偶，用于体验功能。
2. 查看模型能力报告，在“映射与调节”中试动眨眼、张嘴和微笑，并确认需要使用的近似映射。模型缺少对应表情时，需要换用具有这些表情形变的模型。
3. 在“输入设备”中选择摄像头，点击“开启摄像头”，允许浏览器访问摄像头。若没有画面，检查浏览器和系统摄像头权限，关闭占用相机的其他应用后重试。
4. 面对镜头，在“个人校准”中先采集中性脸，再依次采集闭眼、张嘴和微笑。每步保持提示动作 3 秒，看到“本步已保存”后继续；样本不足时重试。抬眉为可选步骤。
5. 尝试转头、点头、眨眼、张嘴和微笑，按效果调节映射、增益和平滑，然后点击“保存配置”。下次打开页面，需要重新选择同一模型文件；已保存的配置会按文件哈希恢复。

“暂停追踪”保留摄像头连接；结束使用时点击“关闭摄像头”释放设备。模型文件和摄像头画面在本机处理，不上传。

### 5. 没有摄像头时体验

导入 `tests/fixtures/diagnostic-vrm1-rich.vrm`，再通过“导入 JSON”导入 `tests/fixtures/example-config.json`。展开“诊断与参数回放”，导入 `tests/fixtures/synthetic-face-sequence.json` 并点击回放，即可查看程序生成的示例动作。此方式用于体验角色驱动与回放，不验证摄像头识别效果。

### 常见启动问题

| 问题 | 处理方法 |
| --- | --- |
| 找不到 `node` 或 `npm` | 安装 Node.js 后重新打开终端，确认 `node --version` 有输出 |
| 找不到 `pnpm` | 执行 `npm install -g pnpm@11.25.0`，再重新打开终端 |
| 提示缺少依赖 | 在含 `package.json` 的目录运行 `pnpm install --frozen-lockfile` |
| 提示追踪资源未准备或下载失败 | 检查下载网络，运行 `pnpm assets:setup`，成功后重新启动 |
| 摄像头权限被拒绝或设备占用 | 在浏览器站点设置与系统设置中允许摄像头，关闭其他占用应用后重试 |
| 角色某个表情没有反应 | 查看模型能力及映射确认状态；模型需要具有对应的表情形变 |

完成首次安装后，每次在项目目录执行 `pnpm dev` 即可启动。Windows 用户也可运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1`。

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
- 目前以 Windows Chrome / Edge 为目标，自动化覆盖 Edge 与 CI Chromium；不同设备的真人效果仍需实际验证。无全身、手部、MMD、音频口型、虚拟摄像头、云端账号、AI 生成或付费 API。
- 这三份原创 CC0 模型用于诊断；真实动漫模型需要自行拥有合法使用权限。见 [模型说明](docs/MODEL_FIXTURES.md)。

## 开发记录

[项目计划](docs/PROJECT_PLAN.md) · [阶段目录](progress/README.md) · [第三方与 XR Animator 参考](docs/THIRD_PARTY.md)

每完成阶段创建 `progress/序号-阶段名/`，记录已完成内容、可复现验证、Git 提交及未完成验收。后续路线继续按计划保留，不以空按钮代替实现。

项目早期使用 AR-Capture 名称，旧配置库及导出文件名保留兼容。后续通过 API 辅助生成 `.vrm` 的功能保留在项目计划中，当前版本尚未实现。
