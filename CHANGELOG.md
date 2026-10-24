# Unreleased

- 精修两个 Codex 风格弹窗：15px 模型文字、18px 图标、更轻的边框阴影、圆角列表悬停与明确的键盘焦点；保留滑轨／旋钮尺寸和现有动效参数。
- 核对 DSH 0.2.1-rc.3 的原生菜单和目录接口；开发 fixture 从安装包读取 CSS Modules 类名，覆盖搜索、空结果与窄屏，避免沿用 rc2 哈希造成视觉测试失真。
- 将浏览器测试矩阵图移入忽略的临时目录，历史发行截图不再被测试覆盖。

- 保留同模型目录短暂清空期间的七档显示别名；模型或真实能力改变时仍清理旧别名。
- 为未返回的 effort 提交增加有界恢复，并隔离超时旧请求的迟到回调。
- RC 阶段移除 `engines.dsh` 预发布版本门槛；已验证版本继续在文档中明确列出。
- 手动回滚只恢复本插件配置，保留其他插件和 profile 的后续改动；加强回滚备份路径检查。
- 在开发用 ASAR 解析器分配内存前验证文件范围、条目大小和完整读取。
- 同步安装文档到已发布的 1.2.1，并区分本分支尚未发布的修复。

English: refine Codex-style typography, icon alignment, hover and keyboard-focus states without changing slider motion; verify rc3 native contracts and load its CSS Module classes dynamically for searchable/empty model fixtures; preserve historical screenshots. Preserve display aliases across transient empty metadata; recover from stalled selections without accepting stale callbacks; remove the DSH prerelease semver gate; preserve unrelated profile changes during rollback; validate ASAR bounds before allocation; and distinguish published installation commands from unreleased fixes.

# dsh-codex-ui 1.2.1

- 仅允许发起拖动的 `pointerId` 更新和结束拖动；其他指针、迟到事件与重复结束事件不会接管或重复提交。
- `pointerup`、`pointercancel` 和 `lostpointercapture` 统一结算当前档位，捕获失败时继续使用窗口安全网。
- Esc（包括焦点不在滑块时）、菜单关闭、重置、模型／会话切换及卸载会释放捕获；取消时清理尚未发出的拖动意图。
- 防止新拖动首帧生成前，宿主档位同步覆盖刚选定的目标；滑块运动参数保持原样。

# dsh-codex-ui 1.2.0

首个独立发行版，基于 Microqian2th/dsh-codex-effort-slider 1.1.2（d1bb67b20bc19d44be7d7694ffca92a6f2fcbe9b），保留原 MIT 许可证与归属。

- 将模型与推理等级菜单改为 Codex 风格卡片和模型列表，支持浅色／深色与窄窗口。
- 提供七个显示档位并映射到四个实际 effort ID：Off (`off`)、Low (`low`)、Medium (`low`)、High (`high`)、XHigh (`high`)、Max (`max`)、Ultra (`max`)；显示名称不声称质量等价。
- Off 为静态灰色，Low 至 Max 五档为静态蓝色；Max 移向 Ultra 的最后六分之一行程中，紫色渐变与星尘按 smoothstep 淡入，回退时平滑淡出。Ultra 横穿基准降至约 3 秒，开启闪电后约 1.7 秒；蓝色区域灰尘速度保持不变。
- 闪电采用实心图标与浅灰圆角底座，移除悬停提示。仅开启时让模型名称渐隐，显示“使用额度消耗更快”后淡出恢复；关闭、换模型和关闭弹窗时取消提示并清理定时器。闪电仍为纯视觉效果，不改变模型请求和实际额度。
- 界面整体按原尺寸的 90% 缩放，卡片约 342×130px；标题 18px、模型名 16px、图标 20px，32px 滑轨配 36px 圆形旋钮。滑轨各层与旋钮显式设为圆角，覆盖 DSH 的全局 superellipse 形状。
- 优化星尘相位连续性，保留原滑块运动引擎。
- 使用 DSH 原生模型条目、选择接口与默认 effort 解析；修复同模型跨会话复用时的乐观状态隔离。
- 独立包名 dsh-codex-ui，支持 DSH 的 npm、Git 仓库和绝对本地目录来源；提供预编译产物，无运行时依赖或安装脚本。
- 增加发行工件、隔离安装、安装器回滚与旧版冲突检查，以及 CI 和发布工作流。

已有 dsh-codex-effort-slider 时，请先在 DSH 插件页卸载旧版，再安装本发行版。两者应仅启用一个。旧的本机挂载与备份不会被发布流程改写。
