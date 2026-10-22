# 发布维护说明

目标仓库：`chadqian2012-sudo/dsh-codex-ui`。目标 npm 包：`dsh-codex-ui`。首个独立发行版本：`1.2.0`。上游同名 npm 包已存在，所以使用新的发行身份；LICENSE 保留上游全文。

## 本次准备与发布状态

- 已准备预编译入口、DSH bundle 元数据、npm files 白名单与官方 publishConfig。
- 2026-10-22 已完成首次公开发布：GitHub 仓库 [chadqian2012-sudo/dsh-codex-ui](https://github.com/chadqian2012-sudo/dsh-codex-ui) 为公开仓库，`v1.2.0` tag 指向提交 `6529a27d0e02abdfe1c815177da7c07d6a3558ff`，GitHub Release 与 npm `dsh-codex-ui@1.2.0` 均已发布。npm tarball shasum 为 `3f12d770adea4240e04b9f59a8057cdde791fd19`；registry integrity 见 VALIDATION.md。
- 发布后官方 DSH CLI 隔离 profile 验收已通过：公开 npm 固定版本、公开固定 Git tag、本地发行目录，以及裸 Git URL 和不带版本号的 npm 名称均通过依赖／bundle 注册、`--dump-config` 和客户端 SHA256 核对。客户端 SHA256 为 `2aaba8634bd27910566d9c02038c4695379136af7e209b2ed1df2373d47ecb05`。CI Windows 与 Linux 均通过：[GitHub Actions run 39778359166](https://github.com/chadqian2012-sudo/dsh-codex-ui/actions/runs/39778359166)。验收回执见下方。
- 独立发布源码在 release/dsh-codex-ui，发布操作在该目录进行；本机 Desktop profile 已备份并迁移到这个发行目录，旧根目录仅保留原身份供回滚。
- 2026-10-22 发布前已完成真实 DSH 对话中的发送、流式输出、停止与停止后续聊验证，以及最新文字提示／关闭清理复验，详见 VALIDATION.md。发布后远端资源与隔离 CLI 下载检查已通过；桌面 Git URL 安装已由用户完成，并只读核对版本、bundle 注册和客户端哈希；用户随后另行确认使用 npm 包名下载完成，并要求停止后续验收。该次 npm 桌面安装来源和文件未独立复核，本地目录的桌面弹窗操作未重复测试；详细边界见 VALIDATION.md。

## 首次发布流程记录

以下保留首次发布时的准备流程作为历史记录。`1.2.0` 已发布，不要再次执行首次发布命令或尝试覆盖同名版本。

首次发布前，维护者在自己的终端确认 GitHub 与 npm 登录有效；密码和令牌不写入源码、工作流或聊天。以下命令保留为当时的准备流程记录；`1.2.0` 已完成发布，切勿重跑 `npm publish`：

```powershell
npm ci --ignore-scripts
npm test
npm run test:distribution
npm run test:install
npm publish --access public --registry=https://registry.npmjs.org/
```

`prepublishOnly` 会再次核验源码与实际 npm 压缩包。不要在已发布同一版本后重复 publish；npm 版本不可覆盖。首次发布前，用 `npm view dsh-codex-ui --registry=https://registry.npmjs.org/` 确认未被其他人占用。若占用则先统一修改发行身份，不能只改 package.json。

新建公开 GitHub 仓库后保留上游历史，提交已核验的修改，再推送 main 和 v1.2.0 tag。Release 附上 npm tgz、ZIP、SHA256SUMS 与发行说明。具体 gh/git 命令由维护者按当前登录账号执行；不要将 upstream 远程写入他人的仓库。

仓库提供 `publish-release.ps1`：先用 `./publish-release.ps1 -WhatIf` 查看目标，登录完成并确认源码已提交后运行 `./publish-release.ps1`。它检查账号、origin 和版本归属，使用独立输出目录，保留已有远端版本和 tag，随后发布 GitHub Release 与 npm。任何阶段失败都会停止；如果 GitHub 已成功而 npm 失败，应使用该次生成的 tgz 在本机完成 npm 发布，而不是覆盖远端 tag 或 Release。需要的 npm 网页登录／2FA 由维护者在自己的终端和浏览器完成。

## 后续无令牌发布

首次 npm 发布成功后，在 npm 包 Settings → Trusted Publisher 配置 GitHub Actions：

| 字段 | 值 |
| --- | --- |
| Organization or user | `chadqian2012-sudo` |
| Repository | `dsh-codex-ui` |
| Workflow filename | `publish.yml` |
| Environment | 留空 |
| Allowed actions | 允许 `npm publish` |

然后通过 GitHub Actions 的 Publish npm package 手动运行下一版本，在 Run workflow 中选择与 package.json 版本一致的 v* tag。工作流只接受手动触发，避免首次推送 tag 时 npm 授权尚未建立就误发任务。它使用 GitHub-hosted runner、Node 24、npm 11 和 id-token: write；不保存 npm token。npm 网站的身份验证和 trusted publisher 设置需由维护者完成。不要把工作流文件已存在误认为 npm 授权已建立。

## 下载源

发布目标固定为 `https://registry.npmjs.org/`。仓库 .npmrc 只作用于此目录。DSH 下载时由用户在安装弹窗选择官方源、镜像源或自定义源，包内不写机器全局配置。镜像同步不由此项目控制。

## 发布后验收

```powershell
npm view dsh-codex-ui@1.2.0 name version dist.integrity --registry=https://registry.npmjs.org/
git ls-remote https://github.com/chadqian2012-sudo/dsh-codex-ui.git refs/tags/v1.2.0
```

使用独立 DSH_HOME/profile 分别安装 npm spec、固定 Git tag 和绝对本地目录，核对 bundle 注册、客户端 id 与入口均为 dsh-codex-ui，再用桌面版原生 UI 完成一次实际安装及菜单验证。不要用真实会话做破坏性测试。

本机保留的 CLI 验收回执（位于被 Git 忽略的 .work，不随发行包分发）：`.work/native-home/public-runs/a05268af-cd90-46a8-936c-7a911f257ef3/public-install-results.json`（npm 固定版本、固定 Git tag、本地目录）；`.work/native-home/public-runs/341f4974-0b47-442b-8eeb-4579da946bdb/public-install-results.json`（裸 Git URL、无版本号 npm 名称）。回执记录隔离 profile、注册结果、配置解析结果和一致的客户端 SHA256。桌面 Git URL 验收回执另见本机 .work/gui-git-install-result.json；npm 包名下载由用户另行确认，未独立复核该次桌面安装文件。

参考：[DSH 官方打包与安装文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)、[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)、[npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)。
