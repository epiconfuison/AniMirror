# 来源、依赖与 XR Animator 对照

核对日期：2026-09-30。确切安装树由 `pnpm-lock.yaml` 保存。

## XR Animator

参考仓库：[ButzYung/SystemAnimatorOnline](https://github.com/ButzYung/SystemAnimatorOnline)。参考其单摄像头面捕、VRM/Perfect Sync 支持、Worker/OffscreenCanvas 与渲染解耦的功能及交互思路。它已具备这些基础能力，本项目不声称独创。

阅读入口：`XR_Animator.html`、`js/facemesh_lib.js`、`js/mocap_lib_module.js`、`readme.md`。该项目为传统脚本/Electron 集成架构，并非可直接装入 React 的组件。本实现独立编写 TrackingFrame、相机调度、VRM 加载器、映射校准和配置保存；**没有复制或改编 XR Animator 源码、素材和模型**，因此没有需要标注改动的上游文件。若后续实际复用，必须增加确切 commit、文件清单、改动和许可记录。

上游 README 的 Copyright/License/Credits 声明改编源码使用 CC BY-NC-SA 4.0；模型与第三方资源需分别看许可，用户自有资产生成视频另有说明。详情以[上游许可段落](https://github.com/ButzYung/SystemAnimatorOnline#copyrightlicensecredits)为准。VMC/Electron、MMD、全身和手部能力不在本版范围。

## 实际依赖与资源

| 项目 | 固定版本/来源 | 声明许可/处理 |
| --- | --- | --- |
| React / react-dom / scheduler | 19.2.0 / 依赖锁 | MIT；npm 包附许可证 |
| Three.js | 0.180.0 | MIT；npm 包附许可证 |
| @pixiv/three-vrm 及其子包 | 3.4.2 | MIT；npm 包附许可证 |
| @mediapipe/tasks-vision | 0.10.32 | 包元数据声明 Apache-2.0；JS/WASM 从已安装包复制 |
| Face Landmarker | Google 模型 float16/1 | [官方模型文档](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/index#models)；固定官方分发 URL 和内容哈希，不训练或修改模型 |
| 三份 diagnostic VRM | 本仓库程序生成 | 原创 CC0-1.0，见 tests/fixtures/LICENSE.md |
| Vite、TypeScript、Vitest、Playwright 等 | package.json / pnpm-lock.yaml | 开发验证工具；各 npm 包含许可，不把它们当作本项目原创 |

`scripts/setup-assets.mjs` 下载地址：`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`。版本及 SHA-256 在 `scripts/tracking-assets.lock.json`，每份本地资源的哈希和大小在生成的 `public/tracking-assets/manifest.json`。

运行包的许可证会由 `scripts/collect-licenses.mjs` 汇总到 `public/THIRD_PARTY_LICENSES.txt` 并进入构建产物。项目自身源码的最终对外授权由仓库所有者决定；第三方许可及诊断模型许可独立保留。

## 实现依据

- [MediaPipe Web 官方集成](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)：VIDEO、FaceLandmarker 输出与同步检测，放入 Worker。
- [three-vrm](https://github.com/pixiv/three-vrm)：VRMLoaderPlugin、rotateVRM0、normalized humanoid 和 ExpressionManager。
- [VRM 表情规范](https://vrm.dev/en/vrm1/expression/)：预设语义与 blink/mouth/lookAt 覆盖规则。

本版没有进行与 XR Animator 相同设备、同模型、同设置的帧率对比实验，不使用上游宣传数值作为本项目性能证据。
