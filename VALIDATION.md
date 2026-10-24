# Unreleased UI／DSH rc3 适配验证（2026-10-24）

当前开发分支在已有审查修复上精修两个弹窗；包版本仍为 1.2.1，npm 和既有 tag 未被替换。

- 本机只读核对：DSH Desktop、官方 model-selection 与 DeepSeek provider 均为 `0.2.1-rc.3`。原生菜单／目录契约 **3 项通过**，确认根菜单两行、ARIA 关联、模型列表与搜索入口、busy／generation 防护、四个真实 effort ID 和默认值委托仍成立。
- 浏览器 fixture 从实际安装包的 CSS Modules 导出中解析类名，使用 rc3 原生样式，不再硬编码 rc2 哈希。搜索能力同时检查类导出与原生 searchbox 源码契约；早期包不提供时基本 fixture 仍能启动，专属搜索场景明确跳过。Provider 分组与搜索输入仍为测试替身，没有宣称复现 primitives 内部 DOM。
- Chromium + React **6 个场景通过，0 失败、0 跳过**：原有七档／映射别名／双会话隔离／指针捕获／提示清理保持；新增大于四模型时的搜索、空结果保留菜单装饰、返回列表、键盘选择、右侧选中标记及窄窗口布局。浅深色、320／1280 CSS px、DPR 1／1.25／1.5 矩阵继续通过。
- 核心回归 **626 项通过、0 失败**。滑块运动、Ultra 平滑渐变与 1.8 倍闪电速度参数没有修改。仅调整两面板局部 CSS；没有新增会话／消息／请求代码。
- 在独立临时 `DSH_HOME` 中，**rc3 官方 Desktop CLI 实际完成当前本地目录安装与 `--dump-config` 解析**；依赖和 bundle 注册正确，所装客户端 SHA-256 与源码一致。没有向该 profile 复制账号凭据。原始回执保存在忽略的 `.work/native-home/public-runs/c25f5670-de11-48fc-be1b-ed00fe9c0906/public-install-results.json`。
- ASAR 解析 **6 项通过**；当前源码 tarball／目录／本地 Git 消费通过；发行资源包含新的开发预览总览。JavaScript 语法与 diff 空白检查通过。
- 预览由 `node test/capture-ui-refinement.mjs` 可复现，见 `preview/screenshots/rc3/overview.png`。测试矩阵截图输出到 `.work/browser-layouts`，不会覆盖历史发行截图。
- 本轮没有更新真实 Desktop profile、重启 DSH 或发送模型请求。真实发送／流式／停止／续聊的既往验收记录仍仅适用于下面明确记录的版本；本轮证据是静态契约、浏览器替身与隔离官方 CLI 安装，不将它们写成 rc3 真实对话验收。

English: the unreleased UI refinement passed 626 core assertions, six browser scenarios, three installed rc3 contracts and six bounded-ASAR tests. Dynamic CSS Module exports prevent stale hashes from invalidating the preview; optional search exports do not block basic fixtures on earlier builds. The official rc3 CLI installed the local source in a fresh isolated profile and resolved its bundle with matching client bytes. No real Desktop profile, credentials or conversation was changed. Preview screenshots come from a React fixture using native rc3 CSS, not the actual host component.

# Unreleased 审查修复验证（2026-10-24）

本节对应审查后的修复分支；未提升版本、创建 tag 或发布 npm。下面的既有 1.2.1／1.2.0 发行记录保持历史含义。

- `npm test`：**626 项通过，0 项失败**。新增同模型空能力表时 Medium／XHigh／Ultra 别名保留、真实 off-only 能力变化失效、永不返回的选择请求恢复、仅转发最后一个排队选择一次、迟到成功／拒绝隔离，以及 Promise 已完成但快照未确认时的独立 deadline 与同 native ID 新意图保护。模型切换会取消旧节流 timer，新操作获得完整的 120 ms 窗口。
- `npm run test:asar`：**6 项通过**。用很小的归档声明超大条目，分配守卫确认在大 Buffer 分配前拒绝；覆盖无效 size／offset、归档越界、截断头部／数据、短读、标准十进制字符串与数值偏移、pickle padding、空条目和原有 unavailable 错误。
- `npm run test:native`：**3 项通过**。新解析器成功读取本机官方 ASAR 中的模型选择客户端、CSS、包信息和 DeepSeek 能力定义；原生目录的 generation 防护契约保持成立。该防护不代表取消已发送的宿主操作。
- `npm run test:browser`：**5 个 Chromium + React 场景通过**。覆盖模型列表、七档与别名、双 composer 会话隔离、键鼠／触屏、捕获丢失和 Escape、闪电提示清理、浅深色与视口／缩放矩阵；fixture 没有向会话发送消息。
- `npm run test:install`：**27 项通过**。在隔离 fixture profile 中验证插件范围的回滚，保留后续其他依赖、bundle 顺序和 profile 元数据；保留无漂移时的原清单字节；兼容旧 state 文件；拒绝 reparse ancestry 与重复消费备份，失败时当前清单及链接不变。
- `npm run test:distribution`：**1 个集成测试通过**，覆盖实际 tarball、目录与本地 Git tag 消费，校验发行包入口与移除 RC semver 门槛。`npm run test:publish`：**17 项通过**；`npm run test:zip`：**4 项通过**。
- JavaScript 语法、`git diff --check` 通过。ASAR 修补完成一次独立的绕过／回归审阅，没有留下已确认的问题。
- 本轮没有安装到用户真实 Desktop profile，也没有发送真实模型请求；当前改动的对话隔离证据来自源码、原生契约和浏览器 fixture，既往真实对话记录见下文。
- 审查指出的 npm OIDC 受保护发布环境需要 GitHub／npm 外部配置，本分支未更改发布工作流或外部账号设置。

English: the unreleased branch passed 626 core assertions, 6 bounded-ASAR tests, 3 native contracts, 5 browser scenarios, 27 installer checks, distribution consumption, 17 publisher checks and 4 ZIP checks. Oversized malformed archives fail before entry allocation, while the installed official archive remains readable. No real Desktop profile or model conversation was changed.

## 已发布 1.2.1 的独立 npm 下载核对

2026-10-24 从官方 registry 实际执行 `npm pack dsh-codex-ui@1.2.1` 成功，包名／版本正确，26 个文件。tarball SHA-256 为 `47a6674dc53cc553726bd7bb71ea808826587b1d31c0a8382ea248cc8d0e4152`，与已发布 GitHub Release 原始工件一致；shasum 为 `621858a356bb085f774e6a2c20194043749f76ab`。此下载的是既有 1.2.1，尚不包含本节 Unreleased 修复。

# 1.2.1 验证记录（2026-10-23）

- 核心回归：**567 项通过，0 项失败**。新增不同指针的移动／按下／结束干扰、捕获丢失结算、重复结束、迟到事件、捕获失败后的窗口安全网，以及 Esc／关闭／卸载／模型切换／重置清理；起手首帧尚未生成时也保留新拖动目标。
- Chromium + React：**5 个场景通过**。使用浏览器真实 `setPointerCapture`／`releasePointerCapture` 验证捕获丢失提交一次；额外注入不同 ID 的事件验证隔离，验证焦点离开滑块后的 Esc 取消。保留原有模型列表、键盘／触屏、会话隔离、提示、布局和主题缩放矩阵测试。
- 本机 DSH 原生菜单契约：**3 个测试通过**；JavaScript 语法与 Git diff 空白检查通过。
- 此次验证运行在本机 Chromium 与隔离宿主 fixture，没有在 Windows 10 实机上重现原始偶发问题。以下 1.2.0 条目是既往发行记录。

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

桌面 Git URL 验收补充：在全新隔离 Desktop profile 的原生“安装第三方插件”弹窗中，使用完整 `https://github.com/chadqian2012-sudo/dsh-codex-ui.git#v1.2.0` 地址和 npm 官方源。用户完成安装后，只读检查依赖记录为 `github:chadqian2012-sudo/dsh-codex-ui#v1.2.0`，包名／版本为 `dsh-codex-ui@1.2.0`，bundle 已注册，客户端 SHA256 与上述发行源码一致；安装后也观察到新的圆形滑块界面。本机回执为 `.work/gui-git-install-result.json`。

桌面 npm 验收补充：首次在已有 Git 插件的 profile 中尝试时，用户反馈“提示插件已经安装”。这是同名插件保护，该次没有完成 npm 重新下载，不能当作 npm 下载通过。随后用户另行明确确认“我用 npm 包名下载好了”，并要求停止继续验收；据此记录为用户确认 npm 包名下载完成。该次桌面操作的安装来源、文件和加载状态未独立复核，不将其写为代理自动化验收通过。公开 npm 包的实际下载、安装、bundle 注册、配置解析和哈希核对已由上面的独立官方 CLI 测试完成。

本地目录的原生弹窗操作未逐项重复验收，官方 CLI 的本地目录安装已通过。此前本地构造的 tgz／Git 验收仍保留为本地测试记录，不作为公开远端来源验收的替代。

预览截图来自隔离 React/DSH 样式 fixture，模型名为测试数据。总览为 `preview/screenshots/v1.2.0/overview.png`。
