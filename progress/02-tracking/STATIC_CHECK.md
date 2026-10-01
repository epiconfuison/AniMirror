# 真实 MediaPipe 静态图片正例验证

2026-09-30 10:16（Asia/Shanghai）通过。使用浏览器实际执行项目 `face.worker.ts`、本地 WASM 和固定版本 Face Landmarker 模型，将同一张静态照片转换为三个 ImageBitmap，依次以 1000、1100、1200 ms 时间戳提交 `VIDEO` 推理，再调用项目 `toTrackingFrame` 转换。没有伪造推理结果，也没有读取真实摄像头。

## 来源与复现

图片源为 [Google MediaPipe 官方 Face Landmarker 示例](https://codepen.io/mediapipe-preview/pen/OJBVQJm) HTML 引用的 [portrait.jpg](https://storage.googleapis.com/mediapipe-assets/portrait.jpg)。核对示例后下载到 `.cache/static-tracking/portrait.jpg`，未把第三方照片加入 Git 或生产应用。图片大小 176561 字节，SHA-256 为 `a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e`。此处仅记录测试来源，不推定照片的再分发许可。

先安装依赖并执行 `pnpm assets:setup`，然后在 PowerShell 执行：

```powershell
New-Item -ItemType Directory -Path .cache/static-tracking -Force | Out-Null
Invoke-WebRequest -Uri 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg' -OutFile .cache/static-tracking/portrait.jpg
node scripts/check-static-tracking.mjs
```

验证脚本位于 `scripts/check-static-tracking.mjs`，也可将一个本地 JPEG 路径作为第一个参数。它启动独立的 `127.0.0.1:5184` Vite 服务与 headless Edge，使用与 `CameraController` 相同的 classic Worker 开发入口；浏览器禁止外部 HTTP 请求，结果保存到 `.cache/static-tracking/result.json`，随后关闭浏览器和服务。照片仅从本机 Node 传给本机浏览器，没有上传操作。

## 本次结果

| 项目 | 结果 |
| --- | --- |
| 浏览器 | Microsoft Edge 154.0.4258.37 |
| Node / MediaPipe | 24.19.0 / tasks-vision 0.10.32 |
| 执行方式 | classic Worker、CPU、VIDEO、单人 |
| 三帧人脸数量 | 每帧 1 |
| 三帧 landmark 数量 | 每帧 478 |
| 三帧姿态矩阵长度 | 每帧 16，所有值有限 |
| MediaPipe 原始分类数 | 每帧 52 |
| TrackingFrame 具名通道数 | 每帧 51；过滤 `_neutral` 非动作分类 |
| 关键通道 | `jawOpen`、`eyeBlinkLeft`、`eyeBlinkRight`、`mouthSmileLeft`、`mouthSmileRight` 均有有限数值 |
| 标准化结果 | 三帧 `faceDetected=true`，三轴弧度均有限 |
| 页面异常 / 外部 HTTP 请求 | 0 / 0 |

固定模型 SHA-256：`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`。

最终运行记录的三帧 CPU 推理耗时为 120.1、28.6、27.1 ms；首帧包含预热成本。这三次静态调用仅作为链路确实执行的证据，不构成实时帧率、P95 延迟或持续性能验收。输入为同一张照片，输出具名系数非零也不代表已验证动作语义或辨别准确率。

仍需真人摄像头验证左右眼、头部三轴、自然度、丢脸恢复、不同光照及 30 分钟稳定性；本检查不能替代这些验收。
