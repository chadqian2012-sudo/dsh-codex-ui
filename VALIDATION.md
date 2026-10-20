# 1.2.0 验证记录

验证日期：2026-10-20（Asia/Shanghai）。独立发行包名：`dsh-codex-ui`。

- 上游基线：`d1bb67b20bc19d44be7d7694ffca92a6f2fcbe9b`，版本 1.1.2；MIT 版权及许可原文保留。
- 本机 DSH 官方运行时／模型菜单：`0.2.1-rc.2`。只读解析 app.asar，未修改它。
- 独立发行身份改名后的客户端回归：**491 项通过，0 项失败**。含提交去重／合并／回滚、重置省略 reasoningEffort、同模型跨会话隔离、卸载清理与星尘相位连续性。
- 官方源码契约：**3 个测试通过**。核对 aria-controls、根／模型 pane roles、列表标记、pending／generation 防护、四个真实 effort ID 和默认值解析。
- 真实 Chromium + React 18：**3 个场景通过**。含菜单来回切换、四档键盘、触屏拖动、延迟目录回报、键盘重置、Esc 关闭、会话隔离及无消息副作用。
- Windows PowerShell 5.1 安装器：**20 项测试通过**。含首次安装、实体目录／正确及错误 junction 更新、重复安装、卸载、手动回滚、WhatIf、manifest 锁冲突恢复；新增旧版仍注册时拒绝安装，并确认原清单字节与目录未改变。
- 发行工件：实际 `npm pack` 白名单检查通过，实际 tgz、本地目录、从同一产物建立的 Git tag 三种隔离消费安装均通过。验证无运行时依赖／安装生命周期脚本，包名、client 注册、Cordis 名称及宿主入口一致。Git 使用本地 `git+file://` 固定 tag，尚不代表公开 GitHub 已发布。
- 官方 Desktop CLI 的真实安装链路：在临时 DSH_HOME 的独立 profile 中，本地目录和 tgz 安装成功，自动注册依赖与 dsh.profile.bundles，`--dump-config` 成功解析插件。目录保存为 `link:`，tgz 保存为 `file:`。未读取或修改真实 Desktop profile。
- 补充官方 CLI 的 Git 来源：通过本地 Git URL 固定提交 `b0841c47c16ad0e01777f610445f49e51e0e7de1` 安装，依赖和 bundle 自动注册，`--dump-config` 成功。该验证不依赖尚未创建的公开仓库，也不代表远端网络下载已经验证。
- 发布流程：**15 项模拟断言通过**。含首次新建仓库、已有仓库、非 404 错误、工作目录、已存在版本／tag 保护、npm 交互输出与失败中止；没有真实外部发布写入。GitHub 发布工作流强制选择与包版本一致的 tag。
- 视觉：浅／深色、320／1280 CSS 像素宽度、DPR 1／1.25／1.5 共 12 张矩阵图；四档和模型列表裁切图；100%／125%／150% 等效缩放图。边界检查通过。
- 滑块运动：与基线逐项比较 MOTION、MOTION_REDUCED、MOTION_FAST、motionStep、motionSettled、releaseIndexFor、detentTargetIndex、decayPointerSpeed，均未改变。

Windows 沙箱最初拦截 pnpm 符号链接与 Git for Windows 的 MSYS 命名对象；使用获批的本机进程环境重跑后成功。该限制与插件加载失败不同，未通过更改系统安全设置解决。

浏览器场景运行真实插件 bundle、DSH 官方 CSS 和隔离模型目录替身。没有向真实会话发送消息或调用真实模型，发送、流式输出、停止、续聊仍未做实机端到端测试；当前 Windows 锁屏，桌面 UI 验收待解锁。

公开 GitHub 仓库、Release、tag 和 npm registry 版本在本次准备阶段尚未发布，等待维护者登录。官方 CLI 的远端 npm／远端 Git 安装仍须在发布成功后复核；不能用本地三来源测试替代这一项。

截图来自隔离环境，模型条目为测试数据；真实安装由 DSH 原生目录提供。`preview/screenshots/v1.2.0/overview.png` 为总览。
