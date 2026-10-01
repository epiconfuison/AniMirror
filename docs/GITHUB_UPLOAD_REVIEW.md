# AniMirror GitHub 测试上传审核

审核日期：2026-10-01。目标仓库：[epiconfuison/AniMirror](https://github.com/epiconfuison/AniMirror)。通过 GitHub 连接器确认其为公开空仓库，默认分支 main，无现有分支；此记录没有创建远程提交或发布网站。

## 结论与发布方式

源码与工程测试可以发布为 **V1 工程预览版**。本次准备不含 `.git` 历史的源码快照，以避免把本地环境修复文档、第三方角色和私人测试数据一起公开。完整真人验收仍按 `ACCEPTANCE.md` 与 `FINAL_TEST_GUIDE.md` 执行。

运行 `pnpm check:upload` 审核当前文件，`pnpm prepare:github` 生成 `.cache/github-upload/时间戳/AniMirror/`，并在同级输出 `manifest.json`。清单包括文件相对路径、字节数和 SHA-256；复制完成后逐文件重新核对哈希。准备目录包含可运行源码，不含依赖和推理二进制；不要把 `.cache/github-upload/` 整体上传。

## 可以上传的内容

| 范围 | 用途与审核结果 |
| --- | --- |
| `src/`、`index.html` | 摄像头、追踪、模型预览、映射、校准、配置与诊断回放实现；项目名称显示为 AniMirror |
| `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` | 固定依赖与 pnpm 11.25.0；Node 最低 22.13，建议 Node 24 |
| `tsconfig.json`、`vite.config.ts`、`playwright.config.ts` | 编译、构建与浏览器测试配置 |
| `scripts/` | 本地资源安装及哈希核对、模型生成、构建服务、验收分析、许可证汇总、上传范围检查；未发现内置 API 密钥 |
| `tests/unit/`、`tests/e2e/` | 42 项单元/集成测试和 7 项浏览器测试；浏览器自动化使用模拟摄像头 |
| 三份原创 `diagnostic-*.vrm` | 仅 `diagnostic-vrm0.vrm`、`diagnostic-vrm1-rich.vrm`、`diagnostic-vrm1-minimal.vrm`；哈希与 `MODEL_FIXTURES.md` 一致，带 CC0 许可 |
| `example-config.json`、`synthetic-face-sequence.json` | 程序生成的配置与 8 秒动作示例，无真人录像和个人校准数据 |
| `tests/fixtures/LICENSE.md` | 诊断模型独立许可，必须保留 |
| `docs/`，排除下表本机文档 | 项目计划、模型说明、测试指南、空白记录模板、第三方声明和本审核记录 |
| `progress/` | 阶段记录与两张诊断人偶截图；截图已查看，无真人摄像头画面。历史结果按原日期保留 |
| `public/THIRD_PARTY_LICENSES.txt` | 19 个运行依赖的许可文本；构建前自动汇总 |
| `.github/workflows/ci.yml`、`.gitignore` | Windows GitHub Actions 测试入口及本地文件排除规则 |

这三份诊断模型合计约 1.61 MiB；全部源码、文档和测试素材约 2.5 MiB，详细大小以本次生成清单为准。

## 保留在本地的内容

| 文件或目录 | 排除依据 |
| --- | --- |
| `tests/fixtures/diagnostic-vrm2.vrm` | 实际约 20.1 MiB、作者元数据为 VRoid Project 的第三方角色；并非 VRM 2 或原创诊断资产。元数据带外部许可 URL，但下载来源、对应许可及再分发条件未完成独立核对，本次保留本地，不复制进源码包 |
| 其他 `.vrm`、`.glb`、`.gltf`、`.fbx`、`.blend`、`.vroid` | 用户模型与制作源文件；本次仅三份原创 VRM 获准进入源码包 |
| `node_modules/`、`.pnpm-store/` | 本机依赖与缓存；检出后按锁文件重新安装 |
| `public/tracking-assets/` | 约 25.2 MiB 的 JS/WASM/模型与生成清单；检出后执行 `assets:setup` 获取并校验 |
| `dist/`、`.cache/`、ZIP、构建日志 | 本机产物、模型下载、临时照片、权限备份、浏览器结果和测试输出；不随源码提交 |
| `docs/SANDBOX_REPAIR.md`、`.git/` | 本机权限修复记录和本地提交历史；源码快照不含这些内容。原开发仓库中该文档仍被 Git 跟踪，直接推送原历史会公开它 |
| `.env*`、`.npmrc`、私钥、证书 | 后续本机配置和凭据；允许提供不含真实值的 `.env.example`，当前没有环境配置模板需求 |
| 真人参数、视频、HAR、内存快照、已填写的测试结果 | 继续放 `.cache/final-tests/` 或已忽略的本地数据目录；不作为公开样例 |

`.gitignore` 已补充模型与本地文件排除规则。它不会自动取消已经被 Git 跟踪的文件；上传检查会对被跟踪的禁止文件报错，避免只靠忽略规则判断。

## 本次验证

- 扫描准备发布的文本文件，未命中常见 GitHub/API/AWS/Slack 密钥、私钥块或明文密钥赋值模式；仅记录位置与规则，不输出匹配值。
- 额外扫描 84 个历史文本对象，未命中上述主要密钥格式。历史文档含本机路径与环境说明，因此准备包仍选择当前源码快照。
- 已核对三份原创 VRM 的 SHA-256、版本和嵌入资源；不存在外部资源 URI。未跟踪的第三方 VRM 已被排除，原文件保留。
- 当前工作目录：42/42 单元测试通过；TypeScript 严格检查与生产构建通过；7/7 生产浏览器测试通过（本次约 50.6 秒）。生产构建保留约 1 MB 主 JS 包的体积提示。
- 独立源码目录：使用锁文件重新安装 134 个包成功；通过官方地址重新下载 Face Landmarker 模型，核对 SHA-256 为 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`，本地资源准备成功。
- 独立源码目录再次验证：上传范围检查、42/42 单元测试、TypeScript 与生产构建、7/7 生产浏览器测试全部通过（浏览器约 49.5 秒）。隔离安装使用项目内依赖缓存，最终源码快照与 ZIP 仍不包含安装后的依赖、模型和构建产物。
- GitHub Actions 配置已添加；远程运行结果需要首次上传后查看，不能把本机结果写作远程 CI 已通过。

检查范围是文件选择、模型来源、已知密钥格式和实际工程测试；未知形式的凭据或所有许可情形不由正则扫描保证。源码整体的对外许可证尚未选定，本次没有自行添加 MIT 或其他整体授权。已有模型与第三方许可继续独立保留。

## 测试者如何运行

在源码根目录使用 Node 24、pnpm 11.25.0：

```powershell
pnpm install --frozen-lockfile
pnpm assets:setup
pnpm test
pnpm build
pnpm test:e2e:build
pnpm dev
```

打开 `http://127.0.0.1:5173`。不连接摄像头时，导入 `diagnostic-vrm1-rich.vrm`、`example-config.json` 和 `synthetic-face-sequence.json`，即可测试模型预览、映射、配置和回放。真实识别质量仍需要摄像头手动测试。

GitHub 工作流采用 Windows runner、Node 24 和已安装 Edge，执行相同的安装、资源准备、上传检查、单元测试、构建和生产浏览器测试。失败时仅保存模拟设备测试日志与诊断证据，保留 7 天。参考：[pnpm 官方 Action](https://github.com/pnpm/action-setup/tree/v4)、[Node 官方 Action](https://github.com/actions/setup-node)、[Playwright CI 文档](https://playwright.dev/docs/ci-intro)。

## 首次上传操作

本次仅完成审核与准备。实际发布时，先确认源码目录中的内容及清单，再在该独立快照根目录执行以下命令，创建新的发布历史：

```powershell
git init -b main
git add .
git commit -m "feat: publish AniMirror V1 engineering preview for testing"
git remote add origin https://github.com/epiconfuison/AniMirror.git
git ls-remote origin
git push -u origin main
```

发布前重新检查远程分支；本次检查为空不代表以后仍为空。若已产生远程内容，应先获取并比较，不使用强制推送。本机 Git CLI 连接 GitHub 时遇到不可用的本地代理，GitHub 连接器的只读仓库检查正常；此次没有修改全局代理或凭据。
