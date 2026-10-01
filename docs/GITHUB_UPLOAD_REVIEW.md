# AniMirror 公开源码范围

更新日期：2026-10-01。仓库：[epiconfuison/AniMirror](https://github.com/epiconfuison/AniMirror)。当前发布等级为 **V1 工程预览版**；首次安装和操作步骤见 [README](../README.md)，对应提交的自动化结果见 [GitHub Actions](https://github.com/epiconfuison/AniMirror/actions)。真人动作成功率、成品动漫材质及长期稳定性仍待实际验证。

## 公开内容

| 范围 | 用途 |
| --- | --- |
| `src/`、入口和构建配置 | 模型导入、摄像头追踪、映射、校准、预览与参数回放 |
| `package.json`、锁文件 | 固定依赖；pnpm 11.25.0，Node 最低 22.13.0，建议 Node 24 |
| `scripts/` | 推理资源准备、素材生成、构建服务、打包、参数分析及发布范围检查 |
| `tests/unit/`、`tests/e2e/` | 单元与浏览器自动化测试；摄像头自动化使用模拟设备 |
| 三份原创诊断 VRM、配置及合成动作示例 | 检查导入和驱动流程，无真人画面或个人校准数据 |
| 模型说明、第三方声明、项目计划及功能阶段记录 | 素材用途、依赖来源、开发状态和后续路线 |
| `tests/fixtures/LICENSE.md`、`public/THIRD_PARTY_LICENSES.txt` | 诊断资产与运行依赖的许可说明 |
| `.github/workflows/ci.yml`、`.gitignore` | 自动化验证入口与本地文件排除规则 |

三份诊断模型仅包括 `diagnostic-vrm0.vrm`、`diagnostic-vrm1-rich.vrm`、`diagnostic-vrm1-minimal.vrm`，均为原创 CC0 资产。版本、大小及 SHA-256 见 [模型说明](MODEL_FIXTURES.md)。已有两张阶段截图只展示诊断人偶界面，不含真人摄像头画面。

## 本地内容

以下内容不随公开源码或发布文档分发：

- 个人电脑配置、环境修复记录、人工测试指南及测试填写模板。
- 自行导入的角色模型、制作源文件、个人配置、真人参数与视频。
- `.env`、本地 npm 配置、私钥、证书、网络及内存快照。
- 依赖缓存、构建日志、临时文件和本地 Git 环境记录。

`public/tracking-assets/` 中的推理资源不提交到 Git，下载源码后通过 `pnpm assets:setup` 获取并校验。生产构建包包含这些运行资源，以便在本机运行。

`.gitignore` 不会自动取消已跟踪文件。公开分支中应移除这些本地文档；发布脚本也排除对应路径，避免从工作目录重新带入源码包。普通删除提交不会清除旧提交中的内容。

## 发布检查

```powershell
pnpm check:upload
pnpm prepare:github
```

第一条检查源码范围、必需文件、三份原创模型哈希、异常大文件及常见密钥格式。第二条生成独立源码目录和逐文件 SHA-256 清单，输出到 `.cache/github-upload/`，复制后再次核对哈希；该命令不创建远程提交。不要把 `.cache/`、依赖或生成的运行资源整体加入 Git。

GitHub Actions 使用 Linux、Node 24 和固定 Playwright 版本对应的 Chromium，执行锁文件安装、推理资源准备、发布检查、单元测试、生产构建和生产浏览器测试。失败截图及 trace 保留 7 天。自动化验证不能替代真人摄像头质量与性能验收。

源码整体的对外许可证尚未选定；诊断资产和第三方依赖按各自许可处理。常见密钥格式扫描不保证发现所有形式的个人信息或凭据。
