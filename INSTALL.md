# 安装、更新与回滚

本发行版的包名是 `dsh-codex-ui`，与上游 `dsh-codex-effort-slider` 区分。三种来源使用相同的包入口、客户端注册 ID 和 bundle patch，任选一种安装。

固定版本示例指向已发布的 `1.2.1`；当前开发分支的 Unreleased 修复需要等待后续版本发布，或从对应修复分支／本地源码安装。既往远端验收记录见 [PUBLISHING.md](PUBLISHING.md)。

## 安装前

先结束正在进行的模型推理。在 DSH 插件管理页查看已安装项；若有 `dsh-codex-effort-slider`，先卸载它，再安装 `dsh-codex-ui`，避免两个界面装饰器同时运行。不要删除 DSH 会话目录或修改 `app.asar`。

## 方式一：npm

在「插件 → 安装第三方插件」输入：

```text
dsh-codex-ui@1.2.1
```

下载源选择「npm 官方源」：`https://registry.npmjs.org/`。也可使用「中国镜像源」`https://registry.npmmirror.com/`；若新版本尚未同步，切回官方源。维护者发布检查见 PUBLISHING.md。

## 方式二：Git 仓库

在同一个输入框填入固定版本：

```text
https://github.com/chadqian2012-sudo/dsh-codex-ui.git#v1.2.1
```

也接受 `github:chadqian2012-sudo/dsh-codex-ui#v1.2.1`。仓库根目录直接包含 package.json 和 lib 产物，不需要 prepare/build 脚本。

## 方式三：本地目录

解压 ZIP，选择**直接包含 package.json 的文件夹**，不要选 ZIP 文件或外层空目录。在同一个输入框填绝对路径，例如：

```text
D:\Plugins\dsh-codex-ui
```

路径含空格时直接粘贴整个路径，无需在界面输入引号。DSH 接受绝对目录，也接受显式的 `link:`／`file:` 来源；其行为由 pnpm 决定。使用链接目录时须保留源文件夹。

三种安装均由 DSH 管理当前 profile 的依赖与 bundle 注册。完成后按 DSH 提示重启以加载客户端更新；本插件的脚本不会自动退出、启动或重启 DSH。

## CLI（Web／自定义 profile）

若已安装官方 `dsh` CLI，可在 Web 或自定义 profile 使用：

```powershell
dsh plugin --profile web add dsh-codex-ui@1.2.1 --registry=https://registry.npmjs.org/
dsh plugin --profile web add "git+https://github.com/chadqian2012-sudo/dsh-codex-ui.git#v1.2.1"
dsh plugin --profile web add "D:/path/to/dsh-codex-ui"
```

Desktop 的 `desktop` 是保留 profile，应优先使用桌面版插件页；不要假设普通 npm CLI 可以修改保留 profile。

本地 CLI 来源可使用本地目录路径。

## 本地离线安装器与回滚

ZIP 中另附 Windows 安装器，默认链接到 Desktop profile。它是原生安装之外的离线选择；会备份本插件目录和 profile 清单。先预览：

```powershell
./install.cmd -WhatIf
./install.cmd
```

如果旧版仍在 profile 注册，安装器会拒绝且不改动清单。请先在 DSH 原生管理页卸载旧版。安装器不会读取会话凭证或修改其他插件的配置。

更新失败时自动尝试恢复旧 manifest 与本插件目录项。手动回滚只恢复本插件的依赖和 bundle 注册，以及本插件目录项；安装后其他插件与 profile 字段的改动保留。使用该次输出的 state.json：

```powershell
./install.cmd -Rollback "C:\Users\<用户名>\.dsh\profiles\desktop\.dsh-plugin-backups\<本次备份目录>\state.json"
```

卸载该发行版：

```powershell
./install.cmd -Uninstall
```

此安装器只管理 `dsh-codex-ui`。早先以 `dsh-codex-effort-slider` 身份生成的备份，需使用当时保留的原安装器回滚；不要交叉使用不同包名的 state.json。

Manual rollback restores only this plugin's dependency, bundle membership, and package entry. Later changes to other plugins and profile fields are preserved. Fixed-version commands above install published 1.2.1; development-branch fixes remain unreleased.

## 更新

本机 DSH 0.2.1-rc.2 的原生管理器会拒绝重复安装相同包名。更新第三方插件时先卸载旧版本，再用同一种或另一种来源安装所需版本；本插件三种来源共用同一个包名，切换来源同样遵循此流程。
