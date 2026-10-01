# 阶段 01：模型接入、能力检查与三维预览

状态：代码、自动测试及诊断人偶的 Edge 浏览器检查完成；真实动漫素材、摄像头动作及长时间人工验收待执行。对应计划 V1-01、V1-02、V1-03，以及 V1-06 的模型输出适配层。

## 已实现

- 本地 `.vrm` 的 GLB 文件头、版本、人形必需骨骼、内嵌资源范围、100 MB 文件/资源、500 万顶点、单网格 128 个 morph 上限检查。外部资源引用在解析前拒绝，加载器也拦截网络 URL。
- 基于文件字节的 SHA-256 模型身份，VRM0/1 经统一 `three-vrm` 加载流程导入。
- 从实际骨骼和表达式绑定生成能力报告；空绑定、零权重及全零 morph 不作为有效驱动能力。报告完整表达式名称、预设/自定义、覆盖规则、原始 morph 与缺失项。
- 加载失败保留原角色；成功替换后才释放旧几何、材质和纹理；取消/过期加载不会替换当前模型。
- 独立帧循环，头部/半身取景、OrbitControls、缩放、旋转、背景、重置、ResizeObserver、每秒 FPS 汇报；销毁时停止 RAF 并释放 WebGL。
- 统一表情写入器保留 VRM 覆盖规则；三轴头部适配处理 VRM0 场景旋转后的 X/Z 轴符号差异。
- 三份原创 CC0 程序生成模型覆盖 VRM0、VRM1 丰富表情、VRM1 缺失表情。它们是诊断人偶，不是成品动漫模型。

## 接口

`src/features/preview/AvatarStage.ts`：

```ts
const stage = new AvatarStage(container, fps => updateFps(fps));
const { asset, capabilities } = await stage.load(file, percent => updateProgress(percent));
stage.apply({ expressions: { aa: 0.6 }, rotation: { x: 0, y: 0.2, z: 0 }, tracking: 'live' });
stage.setFraming('head'); // or 'half'
stage.setBackground('#dce9e5');
stage.resetView();
stage.dispose();
```

`asset.assetId` 是 SHA-256。输入角度为弧度；镜像视频预览不改变输入数据。UI 必须捕获构造时 WebGL 不可用错误及异步 `load` 的错误。`apply` 中省略的目标每帧重置为零，手动试动应通过同一个输出合成器写入。

## 验证

2026-09-30 已运行：

- `node scripts/generate-fixtures.mjs`：成功生成三份 VRM（按 VRM0、VRM1 rich、VRM1 minimal 顺序为 747752、747308、192176 字节），补齐可见颈部。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/vitest/vitest.mjs run tests/unit/avatar.test.ts`：10/10 通过。
- `node node_modules/@playwright/test/cli.js test tests/e2e/studio.spec.ts`：3/3 通过，使用本机 Microsoft Edge 的实际 WebGL 渲染（14.5 秒）。覆盖三模型导入、能力降级、单眼试动、失败替换保留角色、头部/半身取景、模型哈希配置恢复、JSON 导出/导入及不匹配拒绝、清空配置、简洁展示和 Esc 返回。模型流程没有页面异常或外部网络请求。

测试覆盖损坏/伪装/超限文件、外部引用、越界资源、缺失骨骼、哈希稳定性；实际 three-vrm 加载三份模型、VRM0 表情别名、左右眨眼独立性、零形变能力、缺失通道降级、三轴方向一致性；GPU 桩环境验证失败替换保留旧模型及成功替换释放资源。三轴测试同时比较前向和上向量，并断言姿态实际发生变化，避免 roll 未转动也通过的情况。

浏览器截图已目检：VRM0/1 正面方向与手臂放松姿态一致、颈部连接正常；头部试动只闭合角色解剖左眼（画面右侧），另一只眼保持睁开。证据保存于 [半身预览](evidence/vrm1-half.png) 与 [左眼试动](evidence/vrm1-blink-left.png)。完整本地截图另在 `.cache/screenshots/`，该缓存目录不提交。三轴方向由实际模型加载后的矩阵测试验证，尚未执行真实摄像头三轴动作人工验收。

尚未完成：MToon、透明头发、成品动漫模型蒙皮、真实摄像头左右与姿态、长时间资源稳定性人工验收。当前浏览器检查仅覆盖诊断素材的普通材质，不能替代这些验收。Git 提交由主任务按功能统一执行并记录。
