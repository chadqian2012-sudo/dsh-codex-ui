# 1.2.0 验证记录

验证日期：2026-10-22（Asia/Shanghai）。独立发行包名：`dsh-codex-ui`。

- 上游基线：`d1bb67b20bc19d44be7d7694ffca92a6f2fcbe9b`（1.1.2）；保留 MIT 版权和许可原文。
- 本机 DSH：`0.2.1-rc.2`。只读核对官方 app.asar 的模型菜单、目录接口和全局 superellipse CSS，没有修改宿主程序文件。
- 客户端核心回归：**540 项通过，0 项失败**。覆盖七档显示到四个原生 ID 的映射、别名记忆、去重提交、重置竞态、超时回滚、会话隔离、连续相位和运动稳定性。Ultra 正常与快速模式的相位实际位移比为 1.8，速度不再被旧上限截断。
- 真实 Chromium + React 18：**4 个场景通过**。覆盖 native root/model 面板切换、七档键盘、触屏、双 composer 隔离、圆形几何、Ultra 渐显、开启时的文字提示、关闭和重开时的清理。提示动画期间原生模型行仍可点击；没有生成消息或额外的目录提交。
- 原生菜单契约：**3 个测试通过**。核对 aria-controls、root/model roles、模型 ID、pending/generation 防护、四个真实 effort ID 与默认值解析。
- Windows PowerShell 5.1 安装器：**20 项通过**。覆盖首次安装、实体目录和 junction 更新、重复安装、卸载、回滚、清单锁冲突恢复、旧版插件冲突拒绝。只有本插件目录和相关清单项可变更。
- 发布脚本模拟：**16 项通过**。包括 GitHub 和 npm 精确账号校验、干净工作树、已有版本/tag 保护、先测试后外部写入，以及发布失败中止。模拟通过不等于实际发布。
- ZIP：**4 项通过**。使用标准正斜杠 entry 路径；排除开发文件；入口可解析；客户端与源文件字节一致。
- 三来源隔离消费：实际 tgz、本地目录及从同一产物构造的固定 Git tag 安装通过。包内无运行时依赖或安装生命周期脚本。该 Git 来源为本地 Git URL，不代替公开 GitHub 下载验收。
- 官方 Desktop CLI：在隔离 DSH_HOME 的独立 profile 内，本地目录、tgz 和固定 Git 提交安装与 `--dump-config` 均已通过。依赖和 bundle 自动注册。早期沙箱 EPERM 后，获批的真实 Windows 环境重跑成功；未更改系统安全设置。
- 视觉：浅／深色、320／1280 CSS 像素宽度、DPR 1／1.25／1.5 的 12 张矩阵图，以及 100%／125%／150% 等效缩放检查通过。fixture 加载 DSH 的全局 `corner-shape:superellipse(1.5)`，旋钮和轨道显式覆盖为 round。
- 滑块运动：MOTION、MOTION_REDUCED、MOTION_FAST、motionStep、motionSettled、releaseIndexFor、detentTargetIndex、decayPointerSpeed 沿用原基线。仅改视觉能量和星尘相位速度。

## 本机 UI 和对话验证边界

Desktop profile 已备份并从旧的 `dsh-codex-effort-slider` 迁移到本发行目录。迁移前后比较，其他插件和 profile 配置值一致；未修改既有会话和用户草稿。

2026-10-21 使用 Windows MCP 在独立“DSH UI 插件验收测试”会话中，已观察到标准圆形旋钮、圆弧轨道、Max 蓝色／Ultra 紫色、闪电状态、重置默认 High，以及 Flash → Pro → Flash 的原生模型选择。普通消息返回 `DSH-UI-OK`，长回复完成到 `DSH-STREAM-1000`。这些是当时已加载客户端的实机结果。

2026-10-22 在上述独立测试会话中刷新加载最新客户端，并使用 Windows MCP 复验：Max 蓝色、Ultra 紫色、Off 灰色；圆形旋钮与轨道；开启闪电时显示“使用额度消耗更快”并自动恢复模型名称，关闭时不重播提示；High 蓝色区域开启闪电后出现灰色移动星尘；重置恢复 High；原生模型列表可打开，Esc 可返回并关闭。正常／快速速度比 1.8 由帧时钟测试定量确认，实机确认两种状态均持续显示星尘。

同日实际发送独立的 2000 行流式测试请求，观察到持续输出后点击原生停止按钮，回复在约 `DSH-STOP-TEST-1059` 处中断且显示“已停止”；随后发送续聊请求，正常返回 `DSH-RESUME-OK`，状态显示“已完成”，输入框恢复可发送。没有调用模型工具或操作用户文件。测试结束保持会话空闲、闪电关闭、默认 High。

这些结果确认已覆盖的发送、流式、停止、续聊和菜单流程可用，不代表对所有宿主功能作无回归保证。方向键、Home/End、触屏与窄屏／缩放矩阵由上述 Chromium 场景覆盖，未将其全部记为真实桌面人工验收。

## 远端发布和下载验证

2026-10-22 已完成公开发布：GitHub 仓库 [chadqian2012-sudo/dsh-codex-ui](https://github.com/chadqian2012-sudo/dsh-codex-ui)，tag `v1.2.0` 指向 `6529a27d0e02abdfe1c815177da7c07d6a3558ff`，GitHub Release 和 npm `dsh-codex-ui@1.2.0` 均可用。npm shasum 为 `3f12d770adea4240e04b9f59a8057cdde791fd19`；registry integrity 为 `sha512-qvDKpRx0p4RnAHPLzvQy/u0ydt9zt2HqRjraTdIYNMoTSUkidZhKgotijHU0VND1UUwZXCr+6M/OSx95B02ywg==`。CI Windows/Linux 均成功：[GitHub Actions run 39778359166](https://github.com/chadqian2012-sudo/dsh-codex-ui/actions/runs/39778359166)。

官方 DSH CLI 在全新隔离 DSH_HOME/profile 中完成了公开来源安装验收：`dsh-codex-ui@1.2.0`、固定 Git URL `git+https://github.com/chadqian2012-sudo/dsh-codex-ui.git#v1.2.0`、本地发行目录、裸 Git URL `https://github.com/chadqian2012-sudo/dsh-codex-ui.git#v1.2.0` 和无版本号 npm 名称 `dsh-codex-ui`。所有来源均通过依赖和 bundle 注册、`--dump-config` 解析；已安装 `lib/client.js` SHA256 与发行源码相同，为 `2aaba8634bd27910566d9c02038c4695379136af7e209b2ed1df2373d47ecb05`。回执：`.work/native-home/public-runs/a05268af-cd90-46a8-936c-7a911f257ef3/public-install-results.json` 和 `.work/native-home/public-runs/341f4974-0b47-442b-8eeb-4579da946bdb/public-install-results.json`。

**仍待补验：**在桌面版原生插件弹窗中，分别粘贴 npm、Git、本地目录来源并完成实际安装后的菜单验收。Windows MCP 用户控制状态反复出现，因此这里不声称桌面弹窗逐项安装或全量 GUI 验收已经通过。此前本地构造的 tgz／Git 验收仍保留为本地测试记录，不作为公开远端来源验收的替代。

预览截图来自隔离 React/DSH 样式 fixture，模型名为测试数据。总览为 `preview/screenshots/v1.2.0/overview.png`。
