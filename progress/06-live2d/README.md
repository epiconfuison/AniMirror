# 阶段 06：Live2D 支持（Cubism SDK for Web 5-r.5）

状态：阶段 1–7 的工程实现、自动化测试与文档已完成（2026-10-18）。真实摄像头真人动作、成品动漫模型的视觉质量、长时间运行稳定性仍需人工验收；自动化与模拟摄像头结果不作为真人质量证据。

对应计划：[plan.md](../../plan.md) 的阶段 1–7 与第 5 节交付清单。

## 1. 阶段 1：源码审计与基线（2026-10-18 复核）

阶段 1 的审计记录最初只存在于计划正文，仓库中没有对应文件；本次按真实源码重新核对并补建本文档。基线提交：`a9f7f69`（`docs: add first-use instructions and remove local test records`）。

### 1.1 调用链（真实路径）

| 环节 | 真实路径 | 职责 | 调用关系 |
| --- | --- | --- | --- |
| 追踪 | `src/core/tracking/CameraController.ts` → `face.worker.ts` → `result.ts` | 摄像头 → Worker 推理 → `toTrackingFrame` 产出 `TrackingFrame` | 应用层 `onFrame` 回调交给 `Retargeter` |
| 校准 | `src/core/retargeting/calibration.ts` + `features/calibration/CalibrationPanel.tsx` | 个人中性值与幅度，与模型无关 | `Retargeter.update` 的输入之一 |
| 映射与合成 | `src/core/retargeting/retargeter.ts`（`update`）、`channels.ts`（`suggestMappings`/`createDefaultProfile`） | 唯一的目标合成写入点，输出 `DriveOutput` | `App` 每帧调用 `stage.apply(output)` |
| 模型更新 | `src/core/avatar/AvatarDriver.ts`（`apply`） | VRM 头部四元数与表情写入 | 原由 `AvatarStage.tick` 调用 `vrm.update` |
| 渲染 | 原 `src/features/preview/AvatarStage.ts` | 独占 `WebGLRenderer`/画布/RAF，同时负责 VRM 驱动 | 现拆为 `PreviewStage` + `VrmAdapter` |
| 配置 | `src/core/profiles/repository.ts`、`validation.ts` | IndexedDB 按模型 SHA-256 保存/恢复，JSON 导入校验 | `App` 通过 `ConfigurationQueue` 串行写入 |
| 诊断 | `features/diagnostics/recording.ts`、`evaluation.ts` | 固定 60 Hz 虚拟时钟回放 | 与实时驱动共用同一个 `Retargeter` |
| 资源释放 | `AvatarStage.dispose`、`CameraController.stop/dispose`、`loadGeneration` | 释放几何/材质/渲染器/摄像头 | 现在由 `PreviewStage.dispose` 与适配器 `dispose` 承担 |

### 1.2 耦合点与改造风险

| 耦合点 | 风险 | 处理 |
| --- | --- | --- |
| `AvatarCapabilities` 是 VRM 形状，被 `suggestMappings`、`profiles/validation.ts`、`MappingPanel` 三处依赖 | 直接把 Cubism 参数塞进去会污染 VRM 结构 | 改为 `ModelCapabilities = VrmCapabilities \| Live2DCapabilities`（`format` 判别），三处改用 `driveTargets()`/`summarizeCapabilities()` |
| `AvatarStage` = 渲染管理器 + VRM 驱动器 | 为 Live2D 再起 RAF、双画布争用 | 拆成 `PreviewStage`（唯一 RAF、尺寸/生命周期/加载事务）与适配器（各自画布） |
| 配置按文件哈希 + 目标校验绑定 VRM 能力 | Live2D 无法表达多文件身份；VRM 配置可能被误用 | 身份改为 `<format>:<hash>`，schema v2 增加 `format`，目标校验按 `driveTargets` 进行，旧键迁移 |
| `AvatarAsset.file: File` | 多文件包无法用单个 `File` 表达 | 改为 `ModelAsset { assetId, name, format, sizeBytes, entry }` |
| `Retargeter` 对目标统一 `clamp(0,1)` | Cubism 中位值为 0 的双向参数（如 `ParamEyeBallX`）无法表达 | 新增 `MappingRule.signed`（允许 `[-1,1]`）与 `MappingRule.invert`（`1 - channel`），VRM 行为不变 |

### 1.3 基线与复跑

- 改造前：`pnpm test` 42/42、`pnpm build` 通过（2026-10-18 本机复跑，与计划记载一致）。
- 浏览器 e2e 需要先执行 `pnpm assets:setup` 准备本地推理资源。本机首次复跑因该资源缺失失败（模拟摄像头用例），补齐后既有 7 条用例全部通过，与计划记载的 7/7 一致。
- 既有可整体复用的机制：`FrameGate` 单帧在途、`loadGeneration` 加载竞争、`ConfigurationQueue` 串行写入、固定 60 Hz 回放、`errors.ts` 错误归类、`LoadingManager.setURLModifier` 同源拦截——Live2D 适配器沿用同样的模式。

## 2. 阶段 2：模型适配契约

- `src/core/contracts/index.ts`：`ModelFormat`、`VrmCapabilities`、`Live2DCapabilities`、`ModelCapabilities`、`ModelAsset`；`ModelProfile` 升到 schemaVersion 2 并带 `format`；`MappingRule` 增加可选 `signed`/`invert`。`TrackingFrame`/`DriveOutput` **未新增字段**（审计结论：已足够表达）。
- `src/core/adapters/adapter.ts`：`ModelAdapter`（`apply`/`update`/`render`/`resize`/`setFraming`/`setBackground`/`resetView`/`dispose` + `canvas`）、`AdapterContext`（容器、进度、`isStale`）、`LoadedModel`、`ModelLoader`、`LoadCancelledError`。
- `src/core/adapters/capabilities.ts`：格式判别、`driveTargets()`、`driveTargetNames()`、`summarizeCapabilities()`。追踪层与 retargeting 不引用 VRM/Cubism 类型。
- 渲染所有权：**每个适配器自管渲染器与画布**；`PreviewStage` 独占唯一 `requestAnimationFrame` 循环，并把尺寸/背景/取景变化转发给当前适配器。没有第二种所有权，也没有第二个应用级循环。
- 生命周期与所有权：见 [docs/LIVE2D.md](../../docs/LIVE2D.md) 第 5 节；模型适配器不得关闭共享摄像头或追踪 Worker。

验收：接口能描述现有 VRM（`VrmAdapter` 承载原 `AvatarStage` 的 VRM 分支），追踪模块没有新增 VRM/Cubism 引用，VRM 分支没有增加 Live2D 特例。

## 3. 阶段 3：现有 VRM 接入适配层

- 新增 `src/core/avatar/VrmAdapter.ts`：把原 `AvatarStage` 的 Three.js 渲染、取景、OrbitControls、手臂放松姿态、`AvatarDriver` 驱动与 `VRMUtils.deepDispose` 封装为适配器；`vrmModelLoader(file)` 返回 `ModelLoader`。
- 新增 `src/features/preview/PreviewStage.ts` 取代 `AvatarStage`：单一 RAF；`load()` 在新模型完全就绪后才替换，失败保留旧模型，过期候选销毁并抛 `LoadCancelledError`。
- `App.tsx` 改用它；能力报告抽成 `features/preview/CapabilityPanel.tsx`，按格式渲染。
- 每帧仍只有一个合成写入点：`App` 的 tick 调 `Retargeter.update` → `stage.apply`；适配器只负责把它写到模型上。
- 配置兼容：v1 profile/bundle 读取时迁移为 v2（`format: 'vrm'`），旧裸哈希键在读取时迁移到 `vrm:<hash>` 并删除旧键。

验收：改造后 `pnpm test` 57/57、`pnpm build` 通过、既有 VRM e2e 用例（导入、替换、失败保留、取景、映射试动、配置保存/恢复、JSON 导入/拒绝、清空、简洁展示）全部通过；连续替换无旧模型残留（`avatar.test.ts` 的生命周期用例与 `PreviewStage` 竞争用例覆盖）。

## 4. 阶段 4：Cubism SDK 接入与静态预览

- SDK：官方 **Cubism SDK for Web 5-r.5**（Core 提交 `d96fa37…`、Framework 提交 `a49bc54…`）。
- `scripts/setup-live2d.mjs` 可复现地把 `Framework/src` 复制到 `src/vendor/cubism/framework`（仅加 `@ts-nocheck` 头）、`Core/live2dcubismcore.min.js` 复制到 `public/vendor/`、`Framework/Shaders/WebGL` 复制到 `public/vendor/cubism-shaders/`，并写出逐文件 SHA-256 锁文件 `scripts/live2d-sdk.lock.json`；`pnpm live2d:check` 校验一致性。
- `index.html` 在应用模块前加载 Core（经典脚本）。r.5 从文件加载着色器，因此着色器随 `public/vendor` 发布。
- `src/core/live2d/pack.ts`：文件夹 → 模型包（路径规范化、`..`/绝对路径/URL/控制字符拒绝、扩展名白名单、4096 文件/64 MB 单文件/120 MB 总量上限、单入口选择）。
- `src/core/live2d/manifest.ts`：`model3.json`（Version 3）严格校验并解析出 moc3、贴图、物理、姿态、表情、动作与布局，所有引用必须落在包内。
- `src/core/live2d/Live2DAdapter.ts`：moc3 → model → 物理/姿态 → 渲染器 → 贴图（`ImageBitmap` 预乘 alpha）→ 能力检测；静态渲染使用与 SDK 示例一致的设备投影，并支持半身/头部取景；销毁时删除贴图、释放渲染器/物理/姿态/moc，`WEBGL_lose_context` 主动丢弃上下文并移除画布。
- 错误分类：缺少描述文件、描述文件版本不符、缺少 moc3/贴图、moc3 解析失败、贴图解码失败、WebGL 上下文不可用、Cubism Core 未加载，都有中文可操作提示；加载失败保留当前模型。

证据（本机 Edge 实际 WebGL 渲染，Hiyori 示例模型）：

- [半身预览](evidence/live2d-half.png)
- [头部取景](evidence/live2d-head.png)

## 5. 阶段 5：能力检测与参数映射

- 能力来自模型自身：`CubismModel` 的参数 ID/最小值/最大值/默认值，加分组、贴图数、绘制对象数、moc 版本、物理/姿态是否存在。
- `src/core/live2d/parameters.ts`：常见参数仅用于标签与建议映射；`parameterValue()` 定义“双向参数以默认值为中位、单极参数按位置”的取值语义；`headParameterValues()` 把弧度的 `x/y/z` 转成 `ParamAngleX/Y/Z` 的度数。
- 建议映射：头部三轴（由适配器直接驱动，不走映射表）、左右眼开合（`invert`）、嘴部开合、微笑（两侧各 0.6）、眉毛（`browInnerUp` 各 0.5）、眼笑；视线 8 条映射标记 `signed` + 未确认，需手动试动确认后才驱动。
- 缺失目标：`MappingPanel` 显示“当前模型缺少目标 X，此规则不会驱动任何参数”，其余通道不受影响。
- 轴向：`HEAD_AXIS_SIGN` 集中定义；用同一段固定回放分别驱动 VRM 与 Live2D 并对比截图确认可见方向一致（[VRM](evidence/axis-yaw-vrm.png) / [Live2D](evidence/axis-yaw-live2d.png)）。
- 顺序：`Retargeter`（校准 → 增益/死区/曲线 → 限幅 → 冲突合成）→ 适配器写入 → 保存参数 → 物理/姿态 → `model.update()`；增益与平滑只应用一次。

## 6. 阶段 6：导入界面、身份与配置

- “角色模型”面板增加 VRM 3D / Live2D 类型选择；VRM 用单文件输入，Live2D 用文件夹输入（`webkitdirectory`），拖放单 `.vrm` 走 VRM，其余走 Live2D 包。
- 身份：`live2d:<sha256(路径\0文件哈希 列表)>`，只覆盖描述文件引用的文件，同名不同内容不会共用配置；VRM 身份为 `vrm:<sha256 文件字节>`。两者前缀不同，配置不会互用。
- 配置：`ModelProfile.schemaVersion = 2` + `format`；`ConfigBundle.schemaVersion = 2`；v1 迁移；`ProfileRepository.restoreModel()` 读取时迁移旧键、按当前模型过滤无效目标并回报丢弃数量；格式不符直接拒绝。
- 刷新页面后模型文件不持久化，界面与 README 都提示需要重新导入。

## 7. 阶段 7：稳定性、测试与文档

- 新增单元测试：`tests/unit/live2d.test.ts`（路径/大小/入口/描述文件/身份/参数语义/建议映射）、`retargeting.test.ts` 增加 signed/invert 用例、`avatar.test.ts` 增加“过期候选被销毁”的加载竞争用例、`profiles.test.ts` 增加 v1→v2 迁移与无效目标过滤用例。
- 新增浏览器测试：`tests/e2e/live2d.spec.ts`（导入示例模型、能力报告、映射试动、保存/恢复、VRM↔Live2D 双向切换、失败导入保留旧模型）。示例模型不在仓库内，缺少时用例显式跳过（CI 即如此）。
- 文档：本文、[Live2D 支持说明](../../docs/LIVE2D.md)、README 的 Live2D 章节、`docs/THIRD_PARTY.md` 的 SDK 与许可条目、`src/vendor/cubism/VENDOR.md`。

## 8. 验证记录（2026-10-18，本机 Windows）

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | **58/58 通过**（8 个测试文件，新增 `tests/unit/live2d.test.ts` 13 条） |
| `pnpm build` | **通过**（`collect-licenses` 汇总 Cubism 许可 + Vite 生产构建） |
| `pnpm test:e2e` | **11/11 通过**（开发模式，本机 Edge 实际 WebGL；含 4 条 Live2D 用例） |
| `pnpm test:e2e:build` | **11/11 通过**（生产构建预览模式） |
| `pnpm check:upload` | **172 个文件、0 条发现、无本地文件被排除** |
| `pnpm live2d:check` | **85 个 vendored 文件与锁文件一致** |

CI 环境没有 SDK 示例模型，`tests/e2e/live2d.spec.ts` 会显式跳过并输出原因；单元测试不依赖 Cubism Core，可在 Node 中验证模型包、描述文件、身份与映射语义。

补充验证（开发期临时脚本，跑完即清理，不随仓库分发）：用同一段固定 60 Hz 回放分别驱动 VRM 与 Live2D 并对比截图（[VRM](evidence/axis-yaw-vrm.png) / [Live2D](evidence/axis-yaw-live2d.png)），以及逐个驱动 `ParamAngleX/Y/Z` 观察头部形变。两者都是开发期目检，不替代真人验收。

## 9. 尚未完成（人工验收）

- 真实摄像头下的左右眼/嘴角/头部方向是否符合用户预期（固定回放只验证管线与格式一致性）。
- 成品动漫模型的视觉质量：物理/姿态观感、贴图边缘、功耗与帧率。
- 30 分钟以上持续运行与反复切换的内存/上下文稳定性。
- Live2D 示例模型的授权用户自测（本项目不复制示例模型）。
