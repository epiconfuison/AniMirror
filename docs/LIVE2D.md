# Live2D 支持说明

本文记录 AniMirror 的 Live2D 支持范围、模型包规则、参数语义、SDK 来源与许可限制。计划与验收记录见 [progress/06-live2d](../progress/06-live2d/README.md)。

## 1. SDK 版本与来源

| 项目 | 值 |
| --- | --- |
| SDK | Live2D Cubism SDK for Web **5-r.5** |
| 来源 | 官方下载页 <https://www.live2d.com/download/cubism-sdk/download-web/>（需接受 Live2D 许可后获取） |
| Core 上游提交 | `d96fa37f45ab8448936200c16a090ca9c2dc2945` |
| Framework 上游提交 | `a49bc546222194ac28326d20a46aa35ee4d1ce8e` |
| vendored 目录 | `src/vendor/cubism/`（Framework 源码 + Core 声明）、`public/vendor/`（Core JS 与着色器） |
| 锁定文件 | `scripts/live2d-sdk.lock.json`（逐文件 SHA-256） |

`src/vendor/cubism/VENDOR.md` 与 `src/vendor/cubism/cubism-info.yml` 随文件保存同样的来源信息。

复现或升级：

```powershell
# 把官方 SDK 解压到 ../resource/CubismSdkForWeb-5-r.5（或用 CUBISM_SDK_DIR 指定）
pnpm live2d:setup     # 复制 Framework/Core/着色器并重写锁文件
pnpm live2d:check     # 只校验现有 vendored 文件与锁文件是否一致
```

### 许可与分发

- **Cubism Core**（`live2dcubismcore.min.js`、`.d.ts`）适用 Live2D Proprietary Software License Agreement，只有 `Core/RedistributableFiles.txt` 列出的文件允许再分发。这些声明与许可原文随文件保存在 `src/vendor/cubism/core/`。
- **Cubism Web Framework** 适用 Live2D Open Software License Agreement，作为本应用的一部分随源码保存，不单独作为 SDK 发布。
- vendored 源码仅添加了 `// @ts-nocheck` 头部（SDK 自身的 tsconfig 未开启严格空值检查），业务代码没有改动。
- **模型不在仓库内**。SDK 自带示例模型（Hiyori / Haru / Mao 等）由 Live2D 授权，本项目不复制、不再分发；Live2D 浏览器验收需要本地提供示例或用户自有模型。
- 本项目对 Live2D 的使用遵守 Cubism SDK 的授权条件；如对外分发包含本项目的应用，请自行复核 Live2D 的许可条款。

## 2. 支持的模型

- 入口：`*.model3.json`，**Version 必须为 3**（Cubism 3 及以后导出的模型使用该版本号）。
- 必需资源：`.moc3`（1 个）、贴图（1–16 张，png/jpg/jpeg/webp）。
- 可选资源：`Physics`（physics3.json）、`Pose`（pose3.json）、`Expressions`（exp3.json）、`Motions`（motion3.json）、`UserData`。
- 不支持：`.moc`（Cubism 2）、带外部 URL 的模型、需要额外音频才能表现的模型、压缩包导入。

模型包规则（`src/core/live2d/pack.ts`、`manifest.ts`）：

1. 选择包含 `.model3.json` 的**整个文件夹**；若同一文件夹下（同一层级）存在多个描述文件会要求缩小选择范围。
2. 所有资源引用必须是相对路径。绝对路径（`/…`、`C:/…`）、URL scheme（`http:`、`blob:`、`data:`）、`..` 跳转、控制字符一律拒绝。
3. 文件夹内文件类型限定为 `moc3`、`png`、`jpg`、`jpeg`、`webp`、`json`；出现其他类型（如 `.exe`、`.js`）直接拒绝整包。
4. 上限：4096 个文件、单文件 64 MB、整包 120 MB。描述文件本身限 4 MB。
5. 描述文件声明的每个资源都必须在包内存在，否则导入失败并指出缺失文件。

## 3. 模型身份与配置

- 身份 = `live2d:` + SHA-256(按路径排序的 `路径\0文件SHA-256` 列表)，只覆盖描述文件真正引用的文件。同一批文件重复选择得到同一身份；换贴图或换 moc3 会得到新身份。
- 配置结构在 v2 中增加 `format`（`vrm` / `live2d`），模型配置与个人校准仍分开保存；v1 配置读取时迁移为 `vrm` 并绑定新身份键。
- 存储键统一为 `<format>:<sha256>`。v1 遗留的裸哈希键在读取时迁移并删除旧键。
- 当前模型不支持的映射目标在恢复时被丢弃，并提示丢弃条数；配置格式与当前模型不符时直接拒绝。

## 4. 参数与驱动语义

能力来自模型自身参数（`CubismModel.getParameterId/Minimum/Maximum/Default`），常见参数名只用于标签与建议映射。

| 追踪数据 | Cubism 参数 | 说明 |
| --- | --- | --- |
| `rotation.y`（转头） | `ParamAngleX` | 角度制，正负与 VRM 渲染方向一致 |
| `rotation.x`（点头） | `ParamAngleY` | 同上 |
| `rotation.z`（歪头） | `ParamAngleZ` | 同上 |
| `eyeBlinkLeft/Right` | `ParamEyeLOpen/ROpen` | 映射规则标记“反向”，用 `1 − 闭眼度` 驱动 |
| `jawOpen` | `ParamMouthOpenY` | |
| `mouthSmileLeft/Right` | `ParamMouthForm` | 两侧各 0.6 权重，相加不超过 1 |
| `browOuterUpLeft/Right`、`browInnerUp` | `ParamBrowLY/RY` | 内眉各贡献 0.5 |
| `eyeSquintLeft/Right` | `ParamEyeLSmile/RSmile` | |
| `eyeLookIn/Out/Up/Down…` | `ParamEyeBallX/Y` | **建议但未确认**：需手动试动确认方向后才会驱动 |

`0`、缺失与无效值的区分沿用既有追踪策略：通道缺失按 0 处理但状态仍标记为追踪丢失/保持，回放与实时驱动共用同一条合成管线（`Retargeter`），每帧每个目标只写入一次。

写入顺序（每帧）：

```
读取有效追踪帧 → 校准/归一化 → 映射与增益 → 限幅/冲突合成（Retargeter）
→ 载入上一帧参数 → 写入映射参数与头部角度 → 保存参数 → 物理/姿态求值 → model.update()
```

增益、平滑与死区只在 `Retargeter` 中应用一次；适配器不再重复施加。

### 角度与方向

- 角度单位统一为“度”：追踪数据是弧度，写入前只做 `×180/π`。
- 轴向约定集中在 `src/core/live2d/parameters.ts` 的 `HEAD_AXIS_SIGN`，与 VRM 侧对比渲染确认了转头/点头/歪头的可见方向；仍建议用你自己的模型试动确认。
- `ParamAngleX/Y/Z` 记为双向参数，允许负值；眼镜合等单极参数按“默认值到上限”的区间映射。

## 5. 渲染与资源生命周期

- 渲染所有权：**每个适配器自带画布与 WebGL 上下文**；`PreviewStage` 独占唯一的 `requestAnimationFrame` 循环，并把尺寸变化转发给当前适配器。没有第二个动画循环。
- 加载事务：新模型完全就绪后才替换当前模型；加载失败保留旧模型；快速连续选择时，过期候选会被销毁（`PreviewStage.load` + `loadGeneration`）。
- 释放：删除贴图、释放渲染器、物理/姿态与 moc，`WEBGL_lose_context` 主动丢弃上下文，移除画布。模型适配器不会关闭共享摄像头或追踪 Worker。
- 物理与姿态：若模型声明 `Physics` / `Pose`，在写入参数之后求值；缺失时跳过，不影响驱动。
- 背景：Live2D 画布透明，背景由舞台容器提供，与 VRM 的背景色设置共用。

## 6. 已知限制

- 不播放模型自带 `Motions` / `Expressions`；只驱动参数。动作与音频口型不在首版范围。
- 视线（`ParamEyeBallX/Y`）默认不驱动，需在映射面板确认；不同模型的方向可能不同。
- 不导入压缩包，不支持 `.moc`，不做模型可视化编辑。
- 刷新页面后模型文件不会自动恢复，需要重新选择文件夹（IndexedDB 只保存配置）。
- 软件渲染（CI 的 SwiftShader）下帧率明显低于本地 GPU；Live2D 逐像素绘制比 VRM 更吃填充率。
- 仓库不附带 Live2D 模型；示例模型的授权由 Live2D 提供，不随源码分发。

## 7. 验证方式

- `pnpm test`：模型包路径边界、描述文件校验、身份哈希、参数映射语义、加载竞争与资源释放。
- `pnpm test:e2e` / `pnpm test:e2e:build`：在提供示例模型时执行 Live2D 导入、能力报告、映射试动、保存/恢复、VRM↔Live2D 双向切换、失败导入保留旧模型。未提供示例模型时该组用例显式跳过（CI 即如此）。
- 真实摄像头、模型视觉质量与长时间运行仍需人工验收；自动化与模拟摄像头结果不作为真人质量证据。
