# dsh-codex-ui 1.2.0

首个独立发行版，基于 Microqian2th/dsh-codex-effort-slider 1.1.2（d1bb67b20bc19d44be7d7694ffca92a6f2fcbe9b），保留原 MIT 许可证与归属。

- 将模型与推理等级菜单改为 Codex 风格卡片和模型列表，支持浅色／深色与窄窗口。
- 使用 DeepSeek 的 off、low、high、max 四个真实档位；high 启用星尘，max 增强。
- 优化星尘相位连续性，保留原滑块运动引擎。
- 使用 DSH 原生模型条目、选择接口与默认 effort 解析；修复同模型跨会话复用时的乐观状态隔离。
- 独立包名 dsh-codex-ui，支持 DSH 的 npm、Git 仓库和绝对本地目录来源；提供预编译产物，无运行时依赖或安装脚本。
- 增加发行工件、隔离安装、安装器回滚与旧版冲突检查，以及 CI 和发布工作流。

已有 dsh-codex-effort-slider 时，请先在 DSH 插件页卸载旧版，再安装本发行版。两者应仅启用一个。旧的本机挂载与备份不会被发布流程改写。
