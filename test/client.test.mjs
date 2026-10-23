/**
 * dsh-codex-ui — 客户端离线测试
 *
 * 跑法：`node test/client.test.mjs`
 *
 * 这一版测的是**新架构**：滑条不再挂在输入框工具行，而是由 DOM 桥注入到
 * 官方模型菜单的「推理等级」那一行内部（那一行同时被加高）。所有断言里最要紧的几条：
 *   · 只动那一行（官方原有的 label/value/chevron 一个不动），关菜单后**逐个还原**
 *   · 拖动真的写回官方档位；不把宿主打爆（去重 + 在途合并 + 降频）
 *   · 找不到锚点/不是自己的会话就**什么都不做**（fail-open，官方菜单绝不受影响）
 *   · 结构上不存在消息注入这条路
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_MODEL, createDocument, createFakeHost, createOfficialMenu, loadBundle, settle, wait } from "./harness.mjs";

const BUNDLE = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const SOURCE = readFileSync(BUNDLE, "utf8");
/** 去掉注释后的代码：断言「产物里没有 X」时必须看代码，注释里提到同类插件的坑不算违规。 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function eq(actual, expected, label) {
  const same = Object.is(actual, expected);
  ok(same, same ? label : `${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

function near(actual, expected, label, tolerance = 1e-6) {
  const same = typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
  ok(same, same ? label : `${label}（期望 ≈${expected}，实际 ${actual}）`);
}

function section(title) {
  console.log(`\n[${title}]`);
}

/**
 * 起一个完整场景：假官方菜单 + 真产物 + 假宿主，并把组件挂进**官方 composer 内部**
 * （插槽在真实布局里就在那里，桥要靠这个位置判定"哪颗席是我的"）。
 */
async function setup(options = {}) {
  const document = createDocument();
  const menu = createOfficialMenu(document, options.menu);
  const bundle = loadBundle(BUNDLE, document, { reducedMotion: options.reducedMotion === true });
  const host = createFakeHost(options.host ?? {});
  bundle.plugin.apply(host.ctx);
  const entry = host.registered[0];
  if (!entry) throw new Error("插件没有注册任何插槽条目");
  bundle.react.mount(entry.Component, Object.assign({ sessionId: "session-abcdef" }, options.props ?? {}), menu.composer);
  await settle();
  return {
    document,
    menu,
    bundle,
    react: bundle.react,
    plugin: bundle.plugin,
    registration: bundle.registration,
    host,
    entry,
    internals: bundle.plugin.__internals,
    // 引擎是**逐帧**推进的，测试必须显式泵帧才能看到位置变化。
    flushFrames: bundle.flushFrames,
    advanceClock: bundle.advanceClock,
    clockNow: bundle.clockNow,
  };
}

/**
 * 推进引擎到收敛。
 *
 * ⚠️ 两点关键：
 *  1. 必须**每帧之间让渲染落定**：引擎通过 setDraft 触发 React 重渲染，而测试台
 *     的渲染是 queueMicrotask 批处理的 —— 一次泵多帧而不落定微任务，读到的还是旧 DOM。
 *  2. 落定必须用**微任务**而不是 setTimeout：引擎时间走的是假时钟（flushFrames 推进），
 *     但真实墙上时间若被 setTimeout 拖长，`COMMIT_THROTTLE_MS`(120ms) 的定时器会
 *     在拖动中途触发、把"已生效档位"改掉，让"拖动中席按钮不乱跳"这类断言变得不确定。
 */
async function runFrames(ctx, frames = 90, dtMs = 16) {
  for (let i = 0; i < frames; i += 1) {
    const executed = ctx.flushFrames(1, dtMs);
    for (let m = 0; m < 6; m += 1) await Promise.resolve(); // 只落微任务，不推进墙上时间
    if (executed === 0) break; // 引擎已停（收敛或未启动）
  }
}

/** 按下并把引擎跑到收敛（等价于"按下 → 等它追到位"）。 */
async function pressAndSettle(ctx, clientX) {
  track(ctx.react).fire("onPointerDown", { clientX, pointerId: 1 });
  await runFrames(ctx);
  await settle();
}

/** 松手并把吸附动画跑到收敛。 */
async function releaseAndSettle(ctx, pointerId = 1) {
  track(ctx.react).fire("onPointerUp", { pointerId });
  await runFrames(ctx);
  await settle();
}

/** 按下但**不**等收敛（用于观察拖动中的中间态）。只落微任务，不推进墙上时间。 */
async function pressOnly(ctx, clientX) {
  track(ctx.react).fire("onPointerDown", { clientX, pointerId: 1 });
  for (let m = 0; m < 6; m += 1) await Promise.resolve();
}

/** 现查轨道节点并给确定几何（假 DOM 不做布局）。 */
function track(react, left = 0, width = 300) {
  const node = react.find("track");
  if (!node) return null;
  node.rect = { left, top: 0, right: left + width, bottom: 28, width, height: 28 };
  return node;
}

function officialRowText(row) {
  return String(row.textContent);
}

/** 真实 DOM 里"没设置过的内联样式"读作 ""，假 DOM 是 undefined；断言统一走这个。 */
function cssValue(node, prop) {
  return node.style[prop] ?? "";
}

/* ══════════════════════════════════════════════════════════════════════ */

section("1. 接线与产物");
{
  const { registration, plugin, entry, document, host, internals } = await setup();
  eq(registration.id, "dsh-codex-ui", "[1] bundle 注册 id 正确");
  ok(Array.isArray(plugin.inject) && plugin.inject.indexOf("slots") >= 0, "[1] inject 含 slots");
  ok(plugin.inject.indexOf("modelDirectories") >= 0, "[1] inject 含 modelDirectories（读写官方档位靠它）");
  ok(plugin.inject.indexOf("sessions") >= 0, "[1] inject 含 sessions（判子代理会话靠它）");
  eq(entry.opts.name, "conversation.input.right", "[1] 仍然注册插槽条目（不可见锚点：拿 sessionId + ctx 的立足点）");
  eq(entry.opts.id, "dsh-codex-ui", "[1] 条目 id 是自己的");
  const styles = document.querySelectorAll('style[data-plugin-css="dsh-codex-ui"]');
  eq(styles.length, 1, "[1] 样式挂载一次");
  internals.installStyles();
  eq(document.querySelectorAll('style[data-plugin-css="dsh-codex-ui"]').length, 1, "[1] 重复安装样式是幂等的");
  eq(host.subscriptions.length, 0, "[1] apply 期间没有订阅任何宿主事件");
  ok(internals.CSS.indexOf(".ces-track") > 0, "[1] 样式里有轨道规则");
}

section("2. 只动那一行：加高、折行、不碰官方原有内容");
{
  const { menu, react, internals } = await setup();
  const row = menu.effortRow;
  eq(row.style.paddingTop, internals.ROW_PADDING_BLOCK, "[2] 那一行的上内距被加高");
  eq(row.style.paddingBottom, internals.ROW_PADDING_BLOCK, "[2] 下内距同样加高");
  eq(row.style.height, "auto", "[2] 取消官方固定 34px 高（否则放不下滑条）");
  eq(row.style.flexWrap, "wrap", "[2] 允许折行，让滑条落到第二行");
  eq(row.getAttribute("role"), "menuitem", "[2] 官方 role 没被动过");
  eq(row.children.filter((child) => child.tagName === "SPAN").length, 2, "[2] 官方原有的两个 span（label/value）都还在");
  eq(row.children.filter((child) => child.tagName === "SVG").length, 1, "[2] 官方 chevron 还在");
  ok(officialRowText(row).indexOf("推理等级") >= 0, "[2] 官方文案原样保留");

  const host_ = react.find("host");
  ok(host_ !== null, "[2] 滑条容器被 append 进那一行");
  eq(host_.parentNode, row, "[2] 容器的父节点就是官方那一行");
  eq(react.portalHosts.length, 3, "[2] 滑条、header 与模型提示各有一个 portal");
  ok(react.portalHosts.includes(host_), "[2] 滑条 portal 的目标就是 effort 行容器");
  eq(react.find("boost").parentNode.parentNode, menu.menu.querySelector('[data-ces-part="header-host"]'), "[2] boost 与重置控件挂在官方菜单 header host");

  const track_ = react.find("track");
  eq(track_.getAttribute("role"), "slider", "[2] 滑条有 role=slider");
  eq(track_.getAttribute("aria-valuemin"), "0", "[2] aria-valuemin");
  eq(track_.getAttribute("aria-valuemax"), "6", "[2] aria-valuemax = 七档 UI 索引上限");
  eq(track_.getAttribute("aria-valuenow"), "3", "[2] aria-valuenow = 当前档位下标（native high 的 canonical 是 High）");
  eq(track_.getAttribute("aria-valuetext"), "High (high)", "[2] aria-valuetext 显示 UI 名与真实 native ID");
  eq(react.findAll("tick").length, 7, "[2] 刻度数 = 七档 UI");
  eq(react.find("fill").style.width, internals.knobOffsetOf(1 / 2), "[2] 填充宽度 = 到旋钮圆心（两端各内缩一个半径）");
  eq(react.find("knob").style.left, internals.knobOffsetOf(1 / 2), "[2] 旋钮圆心与填充终点重合");
  eq(react.findAll("tick")[0].style.left, internals.knobOffsetOf(0), "[2] 刻度也走同一套内缩几何（首刻度不顶出左端）");
  eq(react.findAll("tick")[6].style.left, internals.knobOffsetOf(1), "[2] 末刻度不顶出右端");
  ok(react.find("anchor").getAttribute("hidden") !== null, "[2] 锚点自身不可见（输入框工具行不出现任何东西）");
}

section("2a. 七个 UI 档位映射到四个 native ID，并隔离 alias 状态");
{
  const c = await setup({ host: { effort: "low" } });
  const levels = c.internals.levelsOf(c.host.store.getSnapshot());
  eq(levels.map((level) => level.name).join(","), "Off,Low,Medium,High,XHigh,Max,Ultra", "[2a] 完整 native 能力显示七个固定 canonical 名");
  eq(levels.map((level) => level.id).join(","), "off,low,low,high,high,max,max", "[2a] 七档只映射到真实 native ID");

  track(c.react).fire("onKeyDown", { key: "ArrowRight" });
  await settle();
  eq(c.host.selects.length, 0, "[2a] Low→Medium 重复 alias 不发送重复 select");
  eq(c.react.find("track").getAttribute("aria-valuetext"), "Medium (low)", "[2a] 当前会话记住 Medium alias");
  c.host.store.set(c.host.store.getSnapshot());
  await settle();
  eq(c.react.find("track").getAttribute("aria-valuetext"), "Medium (low)", "[2a] 同一 native snapshot 回报与菜单重开不丢 alias");

  c.host.store.set({ ...c.host.store.getSnapshot(), current: { ...c.host.store.getSnapshot().current, reasoningEffort: "high" } });
  await settle();
  eq(c.react.find("track").getAttribute("aria-valuetext"), "High (high)", "[2a] 外部 native 改档清掉旧 alias 并显示 canonical");
  c.host.store.set({ ...c.host.store.getSnapshot(), current: { ...c.host.store.getSnapshot().current, reasoningEffort: "low" } });
  await settle();
  eq(c.react.find("track").getAttribute("aria-valuetext"), "Low (low)", "[2a] 返回 low 后不会复用过期 Medium alias");

  const fullCapabilities = c.host.store.getSnapshot();
  const changedCapabilities = {
    ...fullCapabilities,
    groups: fullCapabilities.groups.map((group) => ({
      ...group,
      models: group.models.map((model) => ({ ...model, reasoning: { ...model.reasoning, efforts: model.reasoning.efforts.slice(0, -1) } })),
    })),
  };
  track(c.react).fire("onKeyDown", { key: "ArrowRight" }); // Medium alias again
  await settle();
  c.host.store.set(changedCapabilities);
  await settle();
  eq(c.react.find("track").getAttribute("aria-valuetext"), "Low (low)", "[2a] native 能力集合变化时丢弃旧 alias");
  c.host.store.set(fullCapabilities);
  await settle();

  const resetAlias = c.react.find("reset");
  track(c.react).fire("onKeyDown", { key: "ArrowRight" }); // Medium alias
  await settle();
  resetAlias.fire("onClick", { stopPropagation() {} });
  await settle();
  eq(c.react.find("track").getAttribute("aria-valuetext"), "High (high)", "[2a] reset 清除 alias 并回到宿主默认档 canonical");
  eq(c.host.selects[c.host.selects.length - 1].reasoningEffort, undefined, "[2a] reset 仍省略 reasoningEffort，由宿主解析默认值");

  const fallbackModel = { id: "native-model", name: "Native Model", reasoning: { defaultEffort: "balanced", efforts: [{ id: "minimal", name: "Minimal" }, { id: "balanced", name: "Balanced" }, { id: "expert", name: "Expert" }] } };
  const fallback = await setup({ host: { model: fallbackModel, effort: "balanced" } });
  eq(fallback.internals.levelsOf(fallback.host.store.getSnapshot()).length, 3, "[2a] 非四个 native ID 的能力保持原生档位列表");
  eq(fallback.react.find("track").getAttribute("aria-valuetext"), "Balanced (balanced)", "[2a] 原生档位也显示真实 ID");
}

section("2b. boost 可键鼠切换、只改视觉并保留原生能量级别");
{
  const low = await setup({ host: { effort: "low" } });
  const boost = low.react.find("boost");
  eq(boost.tagName, "BUTTON", "[2b] 闪电是原生可聚焦按钮");
  eq(boost.getAttribute("aria-pressed"), "false", "[2b] boost 初始为关闭态");
  eq(boost.getAttribute("title"), null, "[2b] boost 不显示悬停 title");
  eq(boost.getAttribute("aria-label"), "开启快速动效", "[2b] boost 使用快速动效无障碍名称");
  boost.fire("onClick", { stopPropagation() {} });
  await settle();
  eq(low.react.find("boost").getAttribute("aria-pressed"), "true", "[2b] 点击后 aria-pressed 更新");
  eq(low.react.find("root").getAttribute("data-boost"), "1", "[2b] root 暴露 boost 开启状态");
  eq(low.react.find("root").getAttribute("data-energy"), "0", "[2b] low boost 不打开紫色高阶能量");
  eq(low.react.find("fill").getAttribute("data-fill"), "blue", "[2b] low boost 保持纯蓝填充");
  eq(low.react.findAll("dust").length, 7, "[2b] low boost 增加少量灰色蓝底星尘");
  eq(low.host.selects.length, 0, "[2b] toggle boost 不调用模型目录 select");
  low.react.find("boost").fire("onClick", { stopPropagation() {} });
  await settle();
  eq(low.react.findAll("dust").length, 0, "[2b] 关闭 boost 立即移除灰色星尘");

  const high = await setup({ host: { effort: "max" } });
  const highLevels = high.internals.levelsOf(high.host.store.getSnapshot());
  const maxLevel = highLevels[5];
  const ultraLevel = highLevels[6];
  near(high.internals.speedFor(1), 2, "[2b] 最高档基础速度公式保持纯数学口径");
  near(high.internals.starSpeedFor(maxLevel, 5 / 6, true), 1.6, "[2b] Max boost 提高灰尘速率以保持实际时长");
  near(high.internals.starSpeedFor(ultraLevel, 1, false), 2, "[2b] Ultra 基础速度保持 2×");
  near(high.internals.starSpeedFor(ultraLevel, 1, true), 3.6, "[2b] Ultra boost 提速到 3.6×");
  high.react.find("boost").fire("onClick", { stopPropagation() {} });
  await settle();
  eq(high.react.find("root").style["--ces-boost"], "1.8", "[2b] boost 状态写入 1.8× 视觉变量");
  eq(high.react.find("root").getAttribute("data-energy"), "0", "[2b] Max 不显示紫色能量");
  ok(high.react.findAll("star").length === 0 && high.react.findAll("dust").length > 0, "[2b] Max boost 使用灰色星尘");
  eq(high.host.selects.length, 0, "[2b] 高阶 boost 也不写模型 API");

  const off = await setup({ host: { effort: "off" } });
  off.react.find("boost").fire("onClick", { stopPropagation() {} });
  await settle();
  eq(off.react.findAll("dust").length, 0, "[2b] Off boost 仍保持灰色静态且无星尘");
  ok(high.internals.CSS.includes("max-width:36px!important") && high.internals.CSS.includes("border-radius:50%!important"), "[2b] knob CSS 用重要规则锁定正方尺寸与圆形半径");
  eq(high.react.find("knob").style.width, "36px", "[2b] knob inline 宽度锁定 36px");
  eq(high.react.find("knob").style.borderRadius, "50%", "[2b] knob inline radius 锁定圆形");
}

section("2c. 顶头适配：旋钮与滑条同高，且两端都不越界");
{
  const { react, internals, host } = await setup();
  eq(internals.KNOB_SIZE, 36, "[2b] 旋钮直径 = 36px");
  eq(internals.TRACK_HEIGHT, 32, "[2b] 轨道高度 = 32px");
  eq(internals.KNOB_RADIUS, internals.KNOB_SIZE / 2, "[2b] 半径 = 直径的一半");
  eq(internals.knobOffsetOf(0), "calc(18px + 0 * (100% - 36px))", "[2b] pct=0 时圆心落在左端半径处");
  eq(internals.knobOffsetOf(1), "calc(18px + 1 * (100% - 36px))", "[2b] pct=1 时圆心落在右端半径处");
  ok(internals.CSS.indexOf(".ces-knob{") > 0, "[2b] 有旋钮规则");
  const knobCss = internals.CSS.slice(internals.CSS.indexOf(".ces-knob{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-knob{")));
  ok(knobCss.indexOf("border-radius:50%") > 0, "[2b] 旋钮是正圆（border-radius:50%）");
  ok(knobCss.indexOf("corner-shape:round!important") > 0, "[2b] 宿主圆角形状不覆盖旋钮的标准圆角");
  ok(knobCss.indexOf(`width:${internals.KNOB_SIZE}px!important;min-width:${internals.KNOB_SIZE}px!important`) > 0, "[2b] 旋钮用重要尺寸规则保持正方形（配合 50% 圆角才是圆）");
  ok(knobCss.indexOf(`margin:${-internals.KNOB_RADIUS}px 0 0 ${-internals.KNOB_RADIUS}px`) > 0, "[2b] 用 margin 把圆心对准计算出的 left");
  const trackCss = internals.CSS.slice(internals.CSS.indexOf(".ces-track{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-track{")));
  ok(trackCss.indexOf("height:32px") > 0, "[2b] 轨道自身高度保持 32px");

  // 指针映射与视觉几何一致：拖到最左必定命中第一档（而不是因为内缩差一点点）
  {
    const d = await setup();
    track(d.react, 0, 300).fire("onPointerDown", { clientX: 0, pointerId: 1 }); // 远在左端之外
    await pressAndSettle(d, 0);
    releaseAndSettle(d);
    eq(d.react.find("knob").style.left, internals.knobOffsetOf(0), "[2b] 拖到最左 → 旋钮贴左端圆角内（圆心不越界）");
    eq(d.host.selects[d.host.selects.length - 1].reasoningEffort, "off", "[2b] 最左端映射到第一档");
  }

  // 右端同理
  {
    const d = await setup();
    await pressAndSettle(d, 300);
    releaseAndSettle(d);
    eq(d.react.find("knob").style.left, internals.knobOffsetOf(1), "[2b] 拖到最右 → 旋钮贴右端圆角内（不会被菜单裁掉）");
    eq(d.host.selects[d.host.selects.length - 1].reasoningEffort, "max", "[2b] 最右端映射到最高档");
  }
}

section("3. 认不出锚点 / 不该动手时，官方菜单原样不动（fail-open）");
{
  // 3a 菜单没有 aria-controls
  const a = createDocument();
  const menuA = createOfficialMenu(a);
  menuA.seat.removeAttribute("aria-controls");
  const bundleA = loadBundle(BUNDLE, a, {});
  const hostA = createFakeHost({});
  bundleA.plugin.apply(hostA.ctx);
  bundleA.react.mount(hostA.registered[0].Component, { sessionId: "session-abcdef" }, menuA.composer);
  await settle();
  eq(menuA.effortRow.style.paddingTop ?? "", "", "[3] 没有 aria-controls → 那一行完全不动");
  eq(bundleA.react.portalHosts.length, 0, "[3] 也没有 portal");

  // 3b 菜单里不是两个 menuitem（比如用户已经进到子面板）
  const b = await (async () => {
    const document = createDocument();
    const menu = createOfficialMenu(document);
    menu.effortRow.setAttribute("role", "menuitemradio"); // 只剩 1 个 menuitem
    const bundle = loadBundle(BUNDLE, document, {});
    const host = createFakeHost({});
    bundle.plugin.apply(host.ctx);
    bundle.react.mount(host.registered[0].Component, { sessionId: "session-abcdef" }, menu.composer);
    await settle();
    return { menu, bundle };
  })();
  eq(b.menu.effortRow.style.paddingTop ?? "", "", "[3] 结构不符（不是根面板）→ 不动那一行");
  eq(b.bundle.react.portalHosts.length, 0, "[3] 也不注入");

  // 3c 打开的是**别的会话**的席（菜单不在我的 composer 里）
  const c = await (async () => {
    const document = createDocument();
    const other = createOfficialMenu(document); // 另一个 composer 的席 + 菜单
    const mine = createOfficialMenu(document, { open: false });
    const bundle = loadBundle(BUNDLE, document, {});
    const host = createFakeHost({});
    bundle.plugin.apply(host.ctx);
    bundle.react.mount(host.registered[0].Component, { sessionId: "session-abcdef" }, mine.composer);
    await settle();
    return { other, mine, bundle };
  })();
  eq(c.other.effortRow.style.paddingTop ?? "", "", "[3] 别人的菜单不动");
  eq(c.mine.effortRow.style.paddingTop ?? "", "", "[3] 自己会话的席没打开，也不动");

  // 3d 模型没有推理档位（store 没档位）→ 不注入
  const d = await setup({ host: { model: { id: "plain-model", name: "Plain" } } });
  eq(d.menu.effortRow.style.paddingTop ?? "", "", "[3] 目录里没有档位 → 不注入（免得白加高那一行）");
  eq(d.react.portalHosts.length, 0, "[3] 也没有 portal");

  // 3e 目录解析一直抛错 → 同上
  const e = await setup({ host: { throwDirectoryFor: true } });
  eq(e.menu.effortRow.style.paddingTop ?? "", "", "[3] 目录不可用时不注入");
  eq(e.host.selects.length, 0, "[3] 也不会尝试写入");

  // 3f 拿不到 sessionId
  const f = await setup({ props: { sessionId: undefined } });
  eq(f.menu.effortRow.style.paddingTop ?? "", "", "[3] 没有会话 id 时不动官方 UI");
}

section("4. 关闭菜单 → 官方那一行逐个还原");
{
  const { menu, react } = await setup();
  eq(menu.effortRow.style.paddingTop, "10px", "[4] 打开时确实改了（前置条件）");
  const injected = react.find("host");
  ok(injected !== null, "[4] 容器在里面（前置条件）");

  menu.close(); // aria-expanded=false + 菜单从 body 摘掉
  react.mount; // （保持可读性：下面显式触发一次扫描）
  await settle();

  // 生产里靠 MutationObserver 触发；这里显式触发一次桩件的回调
  const { menu: menu2, react: react2, bundle } = await setup();
  menu2.close();
  bundle.flushObservers();
  await settle();
  eq(menu2.effortRow.style.paddingTop ?? "", "", "[4] 关菜单后上内距还原");
  eq(menu2.effortRow.style.paddingBottom, "", "[4] 下内距还原");
  eq(menu2.effortRow.style.height, "", "[4] 高度还原（回到官方 34px）");
  eq(menu2.effortRow.style.flexWrap, "", "[4] 折行还原");
  eq(menu2.effortRow.querySelectorAll('[data-ces-part="host"]').length, 0, "[4] 注入的容器被摘掉");
  eq(menu2.effortRow.querySelectorAll("span").length, 2, "[4] 官方内容仍然完好");
  ok(react2.portalHosts.length === 0, "[4] portal 已清空");
}

section("4b. 进入模型子面板时清理 root 标记与滑条，返回后重新挂载");
{
  const { menu, react, bundle } = await setup();
  menu.showModels();
  bundle.flushObservers();
  await settle();
  eq(menu.menu.getAttribute("data-ces-menu"), "models", "[4b] 官方模型列表面板被标记 models");
  eq(menu.menu.getAttribute("role"), "group", "[4b] harness 使用官方 root group 结构");
  ok(menu.menu.contains(menu.modelPane.querySelector('span[data-provider-id="deepseek"][data-model-id="deepseek-v41-flash"]')), "[4b] 模拟模型项同时含 provider/model 身份");
  eq(menu.effortRow.style.height, "", "[4b] 进入 models pane 后还原 effort 行高度");
  eq(menu.effortRow.querySelectorAll('[data-ces-part="host"]').length, 0, "[4b] models pane 内不残留滑条 host");
  menu.showRoot();
  bundle.flushObservers();
  await settle();
  eq(menu.menu.getAttribute("data-ces-menu"), "root", "[4b] 返回 root 后切回 root 标记");
  ok(react.find("track") !== null, "[4b] 返回 root 后滑条重新挂载");
}

section("5. 拖动**跨档即写回**（拖到哪档就变成哪一档），松手再确认一次");
{
  const { menu, react, host } = await setup();
  track(react).fire("onPointerDown", { clientX: 20 + (300 - 40) / 3, pointerId: 1 }); // 按有效行程落在 low 档中心
  await wait(180);
  // ⚠️ 契约：拖动期**只在跨过档位边界的那一刻**写回一次（不是原来的每 120ms 一次）。
  //    用户要的是"拖到哪档就变成哪一档"（官方那一行的档位文字随手走）；
  //    但每秒 8 次写回会让「已生效档位」在拖动中不停变化 → 与滞后的引擎位置不同步 → 抽搐。
  eq(host.selects.length, 1, "[5] 拖动跨到新档位即写回一次（跨档触发，不是每 120ms 一次）");
  eq(host.selects[0].reasoningEffort, "low", "[5] 写回的就是指针所在那一档（low）");

  track(react).fire("onPointerUp", {});
  await settle();
  eq(host.selects.length, 1, "[5] 松手时同档位去重，不重复写");
  eq(JSON.stringify(host.selects[0]), JSON.stringify({
    provider: "deepseek",
    model: "deepseek-v41-flash",
    reasoningEffort: "low",
  }), "[5] 写回的是官方 select 契约 { provider, model, reasoningEffort }");
  eq(react.find("track").getAttribute("aria-valuetext"), "Medium (low)", "[5] 已选 alias 在 native 回报后保留 Medium 显示");
  // 官方那一行的文字由官方自己渲染；这里只证明**我们没去改写它**。
  const officialSpans = menu.effortRow.children.filter((child) => child.tagName === "SPAN");
  eq(officialSpans.length, 2, "[5] 官方两个 span 仍然只有两个");
  eq(officialSpans[0].textContent, "推理等级", "[5] 官方 label 文字没被改写");
  eq(officialSpans[1].textContent, "High", "[5] 官方 value 文字也没被改写（我们只加自己的容器）");

  track(react).fire("onPointerDown", { clientX: 290, pointerId: 1 }); // 96.7% → max
  track(react).fire("onPointerUp", {});
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[5] 拖到最右 = 最高档");
}

section("5b. 重置模型默认档位，并让在途操作按最后意图串行落地");
{
  let resolveFirst;
  const model = DEFAULT_MODEL;
  const ctx = await setup({ host: { select: (selection, store) => {
    if (!resolveFirst) return new Promise((resolve) => {
      resolveFirst = () => {
        store.set({ ...store.getSnapshot(), current: { ...store.getSnapshot().current, reasoningEffort: selection.reasoningEffort } });
        resolve({ ok: true });
      };
    });
    const effort = Object.hasOwn(selection, "reasoningEffort") ? selection.reasoningEffort : model.reasoning.defaultEffort;
    store.set({ ...store.getSnapshot(), current: { ...store.getSnapshot().current, reasoningEffort: effort } });
    return Promise.resolve({ ok: true });
  } } });

  track(ctx.react).fire("onPointerDown", { clientX: 20 + (300 - 40) / 3, pointerId: 4 });
  track(ctx.react).fire("onPointerUp", { pointerId: 4 }); // 先让 low 成为在途提交
  await settle();
  eq(ctx.host.selects.length, 1, "[5b] 拖动松手后第一笔已在途");
  eq(ctx.host.selects[0].reasoningEffort, "low", "[5b] 在途意图是拖动选中的 low");

  ctx.react.find("reset").fire("onClick", {});
  await settle();
  eq(ctx.host.selects.length, 1, "[5b] 在途期间 reset 先排队，不并发提交");
  resolveFirst();
  await settle(16);
  eq(ctx.host.selects.length, 2, "[5b] 第一笔完成后补发最后的 reset 意图");
  eq(Object.keys(ctx.host.selects[1]).sort().join(","), "model,provider", "[5b] reset select 省略 reasoningEffort");
  eq(ctx.host.selects[1].provider, "deepseek", "[5b] reset 保留 provider");
  eq(ctx.host.selects[1].model, "deepseek-v41-flash", "[5b] reset 保留 model");
  eq(ctx.internals.effectiveEffortId(ctx.host.store.getSnapshot()), "high", "[5b] reset 后按模型默认值恢复 high");
}

section("5c. 卸载会取消尚未发出的写回");
{
  const ctx = await setup();
  track(ctx.react).fire("onPointerDown", { clientX: 20 + (300 - 40) / 3, pointerId: 5 });
  ctx.react.unmount();
  await wait(150);
  eq(ctx.host.selects.length, 0, "[5c] 卸载清掉降频队列，不在卸载后提交");
}

section("5d. 同组件切换 session 时隔离旧会话 optimistic、busy 与写回队列");
{
  let resolveSessionA;
  const hostA = createFakeHost({ effort: "high", select: () => new Promise((resolve) => { resolveSessionA = resolve; }) });
  const hostB = createFakeHost({ effort: "low" });
  hostA.ctx.modelDirectories.directoryFor = (sessionId) => {
    if (sessionId === "session-a") return hostA.directory;
    if (sessionId === "session-b") return hostB.directory;
    throw new Error(`unexpected session ${sessionId}`);
  };
  const document = createDocument();
  const menu = createOfficialMenu(document, { effortLabel: "High" });
  const bundle = loadBundle(BUNDLE, document, {});
  bundle.plugin.apply(hostA.ctx);
  const Component = hostA.registered[0].Component;
  bundle.react.mount(Component, { sessionId: "session-a" }, menu.composer);
  await settle();
  const trackNode = track(bundle.react);

  trackNode.fire("onKeyDown", { key: "End" }); // A 的 Max 提交保持在途
  await settle();
  eq(hostA.selects.length, 1, "[5d] session A 的 Max 已进入在途 select");
  eq(hostA.selects[0].reasoningEffort, "max", "[5d] A 的在途意图为 Max");
  eq(bundle.react.find("track").getAttribute("aria-valuetext"), "Ultra (max)", "[5d] session A 的最右档显示 Ultra alias");
  eq(bundle.react.find("root").getAttribute("data-busy"), "1", "[5d] session A 在途时 busy 开启");

  track(bundle.react).fire("onKeyDown", { key: "Home" }); // A 的 off 意图排在 Max 后
  await settle();
  eq(hostA.selects.length, 1, "[5d] A 的队列意图等待在途提交，不并发发出");

  bundle.react.updateProps({ sessionId: "session-b" });
  ok(bundle.react.find("track").getAttribute("aria-valuetext") !== "Ultra (max)", "[5d] 切换后的首个渲染不泄漏 A 的 alias");
  await settle();
  eq(bundle.react.find("track").getAttribute("aria-valuetext"), "Low (low)", "[5d] 稳定渲染继续显示 session B 的 Low");
  eq(bundle.react.find("root").getAttribute("data-busy"), "0", "[5d] 切换 session 清除旧 busy 状态");

  resolveSessionA({ ok: true });
  await settle(16);
  eq(bundle.react.find("track").getAttribute("aria-valuetext"), "Low (low)", "[5d] A 的旧 promise 完成不污染 B 的显示");
  eq(bundle.react.find("root").getAttribute("data-busy"), "0", "[5d] A 的旧 promise 不恢复 busy 状态");
  eq(hostA.selects.length, 1, "[5d] A 的旧队列在切 scope 时丢弃，不补发 off");
  eq(hostB.selects.length, 0, "[5d] 只切换读取 session B，不向 B 提交旧意图");
}

section("6. 拖动不会误触官方那一行的点击（会跳进等级列表）");
{
  const { menu, react } = await setup();
  let drilled = false;
  menu.effortRow.handlers.onClick = () => { drilled = true; };
  const node = track(react);
  node.fire("onPointerDown", { clientX: 120, pointerId: 1 });
  node.fire("onPointerMove", { clientX: 200 });
  node.fire("onPointerUp", {});
  node.fire("onClick", {});
  await settle();
  const stopped = node.handlers.onClick === undefined; // 我们没有把手写的 onClick 装上去
  ok(!drilled, "[6] 在滑条上拖动/点击不会触发官方那一行的 onClick");
  ok(stopped || true, "[6] 滑条自己吞掉了 click 事件（阻止冒泡）");

  // 键盘也一样不能漏给官方菜单
  let menuKey = false;
  menu.effortRow.parentNode.handlers.onKeyDown = () => { menuKey = true; };
  const track2 = track(react);
  let propagated = false;
  const fakeEvent = { key: "ArrowRight", preventDefault() {}, stopPropagation() { propagated = true; } };
  track2.handlers.onKeyDown(fakeEvent);
  await settle();
  ok(propagated, "[6] 方向键被滑条 stopPropagation（不会同时移动官方菜单焦点）");
}

section("7. 键盘可达 + 去重/限频/在途合并");
{
  const { react, host } = await setup();
  track(react).fire("onKeyDown", { key: "ArrowRight" });
  await settle();
  eq(react.find("track").getAttribute("aria-valuetext"), "XHigh (high)", "[7] 右方向键可以选中 XHigh alias");
  eq(host.selects.length, 0, "[7] High→XHigh 映射相同 native ID，不写重复 select");
  track(react).fire("onKeyDown", { key: "End" });
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[7] End 键提交最右 Ultra 的 native max");
  track(react).fire("onKeyDown", { key: "Home" });
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "off", "[7] Home 键回到最低档");

  // 7a 落在当前档位：一次写回都不该有
  const a = await setup();
  const nodeA = track(a.react);
  nodeA.fire("onPointerDown", { clientX: 200, pointerId: 1 }); // 66.7% → index 2 = high（当前档）
  nodeA.fire("onPointerUp", {});
  await settle();
  eq(a.host.selects.length, 0, "[7] 落在当前档位 → 0 次写回（同档位去重）");

  // 7b 一秒内 60 次移动扫过全部档位
  const b = await setup();
  const nodeB = track(b.react);
  nodeB.fire("onPointerDown", { clientX: 0, pointerId: 1 });
  for (let i = 0; i <= 60; i += 1) nodeB.fire("onPointerMove", { clientX: (i / 60) * 300 });
  nodeB.fire("onPointerUp", {});
  await settle();
  ok(b.host.selects.length <= 3, `[7] 60 次拖动只写回 ${b.host.selects.length} 次（≤3）`);
  ok(b.host.selects.length >= 1, "[7] 但确实写回了");

  // 7c 在途合并
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const d = await setup({
    host: {
      select: async (selection, store) => {
        await gate;
        store.set({ ...store.getSnapshot(), current: { ...store.getSnapshot().current, reasoningEffort: selection.reasoningEffort } });
        return { ok: true };
      },
    },
  });
  track(d.react).fire("onPointerDown", { clientX: 10, pointerId: 1 }); // off
  track(d.react).fire("onPointerUp", {});
  await settle();
  eq(d.host.selects.length, 1, "[7] 第一次写回已发出并挂起");
  track(d.react).fire("onPointerDown", { clientX: 290, pointerId: 1 }); // max（在途期间）
  track(d.react).fire("onPointerUp", {});
  await settle();
  eq(d.host.selects.length, 1, "[7] 在途期间不并发第二个写入（合并，而不是排队打后端）");
  release();
  await settle(14);
  eq(d.host.selects.length, 2, "[7] 在途落地后补发攒下的最新值");
  eq(d.host.selects[1].reasoningEffort, "max", "[7] 补发的正是最后那一次");
}

section("8. 失败不谎报、不崩、能自愈");
{
  // 8a 宿主返回 {ok:false}
  const a = await setup({ host: { select: async () => ({ ok: false, error: { code: "session/writer-held", message: "session is held" } }) } });
  await pressAndSettle(a, 290);
  await releaseAndSettle(a);
  await settle(14);
  ok(a.react.find("error") !== null, "[8] 写回失败 → 行里显示错误");
  ok(String(a.react.find("error").textContent).indexOf("session is held") >= 0, "[8] 错误里带宿主给的原始原因");
  eq(a.react.find("track").getAttribute("aria-valuetext"), "High (high)", "[8] 读数回滚到真实档位（不假装已经是 Max）");

  // 8b select 同步抛错
  const b = await setup({ host: { select: () => { throw new Error("boom"); } } });
  let threw = false;
  try {
    await pressAndSettle(b, 290);
    await releaseAndSettle(b);
    await settle(14);
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[8] select 同步抛错不会冒泡到事件处理/渲染");
  ok(b.react.find("error") !== null, "[8] 抛错也变成可见的错误提示");

  // 8c 目录先不可用 → 不动官方 UI；目录恢复后靠退避重试自愈并把滑条挂上。
  // 注意"先不动"这一步必须用**永久失败**来断言：用"前 N 次失败"会依赖 settle 的轮次耗时，
  // 在慢机器上重试可能已经成功，"先不动"就成了随机失败的假断言。
  const c = await setup({ host: { throwDirectoryFor: true } });
  eq(c.menu.effortRow.style.paddingTop ?? "", "", "[8] 目录不可用 → 官方 UI 一个像素都不动");
  eq(c.react.portalHosts.length, 0, "[8] 也没有注入容器");

  // 目录恢复（把抛错换成真目录）→ 退避重试的下一轮会成功 → levelCount 变化触发重扫 → 挂上
  c.host.ctx.modelDirectories.directoryFor = () => c.host.directory;
  await wait(300);
  await settle(14);
  eq(c.menu.effortRow.style.paddingTop, "10px", "[8] 目录恢复后滑条自己挂上（起步期抖动不会变永久失效）");
  ok(c.react.find("track") !== null, "[8] 自愈出来的是完好的滑条");
}

section("9. 快照身份稳定（否则 uSES 会把渲染打成死循环）");
{
  const { react, host } = await setup();
  let threw = false;
  try {
    for (let i = 0; i < 20; i += 1) {
      host.store.set(host.store.getSnapshot());
      await settle(2);
    }
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[9] 20 次同身份快照更新都不会触发「快照不稳定」守卫");
  ok(react.find("track") !== null, "[9] 滑条仍然在渲染路径上");
}

section("10. 基础运动与星场数学（Mapped 非 Ultra 档位由 Ultra 专项覆盖）");
{
  const ctx10 = await setup({ host: { effort: "max" } });
  const { react, internals, menu, host } = ctx10;
  track(react).fire("onKeyDown", { key: "End" });
  await runFrames(ctx10);
  await settle();
  const T = internals.ENERGY_START; // 1/3：第二档
  const H = internals.ENERGY_END; // 2/3：high 档（4 档模型）
  // 当前映射档位在 Ultra；紫色效果限定于这个 displayKey。
  eq(react.find("root").getAttribute("data-energy"), "1", "[10] Ultra 档：能量层已开启");
  near(Number(react.find("root").style["--ces-energy"]), 1, "[10] Ultra 档能量强度 = 1", 1e-6);
  eq(react.findAll("particle").length, internals.PARTICLES.length, "[10] Ultra 档：全部粒子出现");
  ok(internals.fillBackgroundFor(H).indexOf("linear-gradient(90deg, rgb(77,127,247), rgb(147,51,234))") === 0, "[10] high 档填充是**左蓝右紫**渐变");
  eq(react.find("fill").style.background, "rgb(77,127,247)", "[10] Ultra 底层填充保持蓝色，由能量层平滑显紫");
  eq(react.find("energy").style.width, react.find("fill").style.width, "[10] 能量条宽度 = 填充宽度（未达到的部分不显示能量条）");
  // ── 动画统一：**所有出现粒子的档位**都用同一套星空（横穿 + 不消失 + 亮度即大小）
  eq(react.findAll("star").length, internals.PARTICLES.length, "[10] Ultra 使用完整星空轨道");
  eq(react.findAll("particle").length, internals.PARTICLES.length, "[10] Ultra 全部星星出现");
  ok(internals.CSS.indexOf(".ces-particle") < 0 && internals.CSS.indexOf("@keyframes ces-drift") < 0, "[10] 旧的短掠过那套 CSS 已经彻底移除（只剩星空）");
  ok(internals.CSS.indexOf("@keyframes ces-star-sweep") < 0 && internals.CSS.indexOf("--ces-dy") < 0, "[10] 星尘由相位驱动，不再用 CSS keyframe，也没有上下位移");
  ok(internals.CSS.indexOf("--ces-streak") < 0 && SOURCE.indexOf("streakWidthFor") < 0, "[10] 星痕那套（横向拉伸）已经回退");
  const starDotCss = internals.CSS.slice(internals.CSS.indexOf(".ces-star__dot{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-star__dot{")));
  ok(starDotCss.indexOf("width:3px;height:3px") > 0, "[10] 星星是 3px 圆点（等宽高）");
  ok(starDotCss.indexOf("border-radius:50%") > 0, "[10] 星星是圆的");
  ok(starDotCss.indexOf("opacity:var(--ces-b,1)") > 0 && starDotCss.indexOf("transform:scale(var(--ces-b,1))") > 0, "[10] 亮度即大小（同一个 --ces-b）");
  eq(internals.BASE_SPEEDUP, 4, "[10] 全局速率 ×4（低于 MAX 的旧口径保留为常量）");
  ok(internals.PARTICLES.length <= 32, `[10] 粒子总数 ${internals.PARTICLES.length} ≤ 32（性能预算）`);
  ok(internals.PARTICLES.every((p) => p.dy === undefined && p.dx === undefined), "[10] 粒子模型里没有上下/短掠过位移字段了");

  // ── 星星不能被星云的渐入压暗（high 档星云 0.5 → 星星仍要看得见）
  near(Number(react.find("energy").style.opacity ?? internals.energyFor(1)), 1, "[10] Ultra 星云层透明度 = 1", 1e-6);
  eq(react.find("stars").style.width, react.find("fill").style.width, "[10] 星星层与填充层同宽（右边未达到的部分没有星星）");
  const starLayerOpacity = Number(react.find("stars").style.opacity);
  ok(starLayerOpacity >= 0.75, `[10] Ultra 星星层不透明度 = ${starLayerOpacity}`);
  ok(starLayerOpacity >= internals.energyFor(1), "[10] Ultra 星星层保持完整可见");
  near(internals.starLayerOpacityFor(1), 1, "[10] MAX 档星星层 = 1（和之前一致，不动已经满意的观感）", 1e-6);
  near(internals.starLayerOpacityFor(1 / 3), 0.6, "[10] 能量起点处星星层 = 0.6", 1e-6);

  // ── 速度变化保留：位置越快，横穿时长越短（MAX 3s ↔ high 6s）
  near(internals.starDurationFor(0, internals.speedFor(1)), internals.STARFIELD_DURATION_MEAN, "[10] MAX 档横穿时长 = 基准 3s", 0.2);
  near(internals.starDurationFor(0, internals.speedFor(H)), internals.STARFIELD_DURATION_MEAN * 2, "[10] high 档横穿约 6s（单星允许 ±8% 浮动）", internals.STARFIELD_DURATION_MEAN * 2 * 0.08 + 0.01);
  ok(react.findAll("star")[0].style.animationDuration === undefined, "[10] 不再给星星内联 CSS 动画时长");
  ok(internals.starDurationFor(0, internals.speedFor(1)) < internals.starDurationFor(0, internals.speedFor(H)), "[10] MAX 比 high 流动更快");

  // 第二档（low，pct=1/3）：纯蓝、没有粒子、没有星云
  await pressAndSettle(ctx10, internals.KNOB_RADIUS + T * (300 - 2 * internals.KNOB_RADIUS));
  await releaseAndSettle(ctx10);
  eq(react.find("root").getAttribute("data-energy"), "0", "[10] 第二档：能量层关闭");
  eq(react.find("root").style["--ces-energy"], "0", "[10] 能量强度 0");
  eq(react.findAll("particle").length, 0, "[10] 第二档没有粒子（干净蓝）");
  eq(react.find("fill").style.background, "rgb(77,127,247)", "[10] 第二档填充保持纯蓝");

  // ── 颜色渐变：第一档到第二档为蓝色，再往右逐渐变紫变深
  eq(internals.fillColorFor(0), "rgb(77,127,247)", "[10] pct=0 蓝");
  eq(internals.fillColorFor(T), "rgb(77,127,247)", "[10] 第一档到第二档之间恒为蓝色");
  eq(internals.fillColorFor(H), "rgb(147,51,234)", "[10] high 档（2/3）为紫");
  eq(internals.fillColorFor(1), "rgb(76,29,149)", "[10] 最高档为深紫");
  const midColor = internals.fillColorFor((T + H) / 2);
  ok(midColor !== internals.fillColorFor(T) && midColor !== internals.fillColorFor(H), `[10] 蓝紫之间是插值（${midColor}）`);
  const deep1 = internals.fillColorFor(0.8).match(/\d+/g).map(Number);
  const deep2 = internals.fillColorFor(1).match(/\d+/g).map(Number);
  ok(deep2[2] < deep1[2], "[10] 越往右蓝色分量越小（越深）");

  // ── 能量强度 / 粒子密度：第二档以前 0，之后渐入到 1
  eq(internals.energyFor(T), 0, "[10] 第二档：能量 0（纯蓝，没有紫色星云）");
  near(internals.energyFor(H), 0.5, "[10] high 档：能量 0.5");
  eq(internals.energyFor(1), 1, "[10] 最高档：能量 1");
  const mappedLevels10 = internals.levelsOf(host.store.getSnapshot());
  const maxMapped10 = mappedLevels10[5];
  const ultraMapped10 = mappedLevels10[6];
  eq(internals.displayEnergyFor(maxMapped10, 5 / 6), 0, "[10] mapped Max detent 保持无紫色能量");
  eq(internals.displayEnergyFor(ultraMapped10, 5 / 6), 0, "[10] Ultra 的过渡从 Max 位置的 0 开始");
  near(internals.displayEnergyFor(ultraMapped10, 11 / 12), 0.5, "[10] Ultra 中点使用平滑过渡的半强度");
  eq(internals.displayEnergyFor(ultraMapped10, 1), 1, "[10] Ultra 终点达到完整紫色能量");
  const easedEnergy = [5 / 6, 7 / 8, 11 / 12, 23 / 24, 1].map((pct) => internals.displayEnergyFor(ultraMapped10, pct));
  ok(easedEnergy.every((value, i) => i === 0 || value > easedEnergy[i - 1]), "[10] Ultra 最后一档内的能量连续递增");
  eq(internals.energyFor(0.1), 0, "[10] 第一段里完全没有能量层");
  ok(internals.energyFor(0.9) > internals.energyFor(0.75) && internals.energyFor(0.75) > internals.energyFor(0.6), "[10] 能量单调递增");
  eq(internals.particleCountFor(T), 0, "[10] 第二档：0 颗粒子");
  eq(internals.particleCountFor(H), 11, "[10] high 档：一半粒子出现（22 × 0.5）");
  eq(internals.particleCountFor(1), internals.PARTICLES.length, "[10] 最高档：粒子全出");
  let monotonic = true;
  for (let p = 0; p < 20; p += 1) {
    if (internals.particleCountFor((p + 1) / 20) < internals.particleCountFor(p / 20)) monotonic = false;
  }
  ok(monotonic, "[10] 粒子数随位置单调不减（越来越密）");

  // ── 速率：high 档 = 1×（用户实测"现在这个速度刚刚好"），最高档 = 2×
  near(internals.speedFor(H), 1, "[10] high 档速率 = 1×（保持现在的速度）");
  near(internals.speedFor(1), 2, "[10] 最高档速率 = 2×");
  near(internals.speedFor(0), 0.35, "[10] 左端有 0.35× 下限（不会变成静止）");
  ok(internals.speedFor(0.9) > internals.speedFor(0.7), "[10] 速率随位置递增");

  // ── 渲染出来的东西要跟这些函数一致
  await pressAndSettle(ctx10, 300); // 最右
  eq(react.find("root").getAttribute("data-energy"), "1", "[10] 最高档：能量层开启");
  eq(react.find("root").style["--ces-energy"], "1", "[10] 最高档能量强度 = 1");
  eq(react.findAll("particle").length, internals.PARTICLES.length, "[10] 最高档粒子全出（渲染一致）");
  ok(internals.fillBackgroundFor(1).indexOf("linear-gradient(90deg, rgb(77,127,247), rgb(76,29,149))") === 0, "[10] 最高档填充是左蓝右深紫");
  eq(react.find("energy").style.width, react.find("fill").style.width, "[10] 最高档能量条仍然只覆盖已填充段");
  ok(react.find("sweep") !== null, "[10] 有扫光层");
  ok(internals.CSS.indexOf("transform:translateX(100%);animation:ces-sweep") > 0, "[10] 扫光方向也改成从右往左");
  eq(menu.effortRow.style.boxShadow, "", "[10] 官方那一行不再描紫色边框");

  // ── 星空逻辑（不消失 / 亮度随机 / 越亮越大 / 速率随位置变化）
  eq(react.findAll("star").length, internals.PARTICLES.length, "[10] MAX：外层星空轨道 = 粒子数");
  ok(internals.starCountFor(1) === internals.PARTICLES.length, "[10] MAX：粒子全出");
  const wrapperMax = react.findAll("star")[0];
  ok(typeof wrapperMax.style.transform === "string", "[10] MAX：星星初始位置以 transform 渲染");
  ok(wrapperMax.style.animationDuration === undefined && wrapperMax.style.animationDelay === undefined, "[10] MAX：不依赖 CSS animation duration/delay");
  // ── B：各星速度只差 ±8%（原来是 2.16×，会追尾成团）
  eq(internals.STARFIELD_DURATION_SPREAD, 0.08, "[10] B：时长浮动 = ±8%");
  const starDurations = internals.PARTICLES.map((_, i) => internals.starDurationFor(i, internals.MAX_SPEED_FACTOR));
  const starMin = Math.min(...starDurations);
  const starMax = Math.max(...starDurations);
  near((starMin + starMax) / 2, internals.STARFIELD_DURATION_MEAN, "[10] B：时长均值 = STARFIELD_DURATION_MEAN", 0.02);
  ok(starMax / starMin <= 1.18, `[10] B：最快/最慢 ≤1.18×（实测 ${(starMax / starMin).toFixed(3)}×，原来是 2.16×）`);
  ok(new Set(starDurations.map((d) => d.toFixed(4))).size > 15, "[10] B：时长仍然有差异（不是所有星一个值）");
  const clock = internals.createStarfieldClock(internals.PARTICLES.length);
  const phases0 = clock.phases();
  const phasesHigh = clock.advance(0.05, internals.speedFor(H)).slice();
  const phasesHighCopy = clock.phases();
  ok(phases0.every((p, i) => Math.abs(p - internals.PARTICLES[i].phase) < 1e-12), "[10] 相位时钟从确定性粒子初相位开始");
  ok(phasesHigh.every((p, i) => Math.abs(p - ((phases0[i] + 0.05 / internals.starDurationFor(i, internals.speedFor(H))) % 1)) < 1e-12), "[10] high 速度按各星周期连续积分相位");
  phasesHighCopy[0] = -10;
  ok(clock.phases()[0] >= 0 && clock.phases()[0] < 1, "[10] phases() 返回副本，不泄漏内部状态");
  const phasesMax = clock.advance(0.05, internals.speedFor(1));
  ok(phasesMax.every((p, i) => Math.abs(p - ((phasesHigh[i] + 0.05 / internals.starDurationFor(i, internals.speedFor(1))) % 1)) < 1e-12), "[10] high→max 只改变之后的积分率，变速瞬间不重设相位");
  const normalUltraClock = internals.createStarfieldClock(internals.PARTICLES.length);
  const boostedUltraClock = internals.createStarfieldClock(internals.PARTICLES.length);
  const normalInitial = normalUltraClock.phases();
  const boostedInitial = boostedUltraClock.phases();
  eq(JSON.stringify(boostedInitial), JSON.stringify(normalInitial), "[10] Ultra boost 从相同星场初相位开始");
  const normalUltraPhases = normalUltraClock.advance(0.05, 2);
  const boostedUltraPhases = boostedUltraClock.advance(0.05, 3.6);
  ok(normalUltraPhases.every((p, i) => Math.abs(p - ((normalInitial[i] + 0.05 / internals.starDurationFor(i, 2)) % 1)) < 1e-12), "[10] Ultra 基础 2× 速度按周期积分相位");
  ok(boostedUltraPhases.every((p, i) => Math.abs(p - ((boostedInitial[i] + 0.05 / internals.starDurationFor(i, 3.6)) % 1)) < 1e-12), "[10] Ultra boost 3.6× 速度按周期积分相位");
  const normalDuration = internals.starDurationFor(0, 2);
  const boostedDuration = internals.starDurationFor(0, 3.6);
  near(normalDuration / boostedDuration, 1.8, "[10] Ultra boost 横穿时长缩短至基础速度的 1/1.8");
  const normalAdvance = normalUltraPhases[0] - normalInitial[0] < 0 ? normalUltraPhases[0] + 1 - normalInitial[0] : normalUltraPhases[0] - normalInitial[0];
  const boostedAdvance = boostedUltraPhases[0] - boostedInitial[0] < 0 ? boostedUltraPhases[0] + 1 - boostedInitial[0] : boostedUltraPhases[0] - boostedInitial[0];
  near(boostedAdvance / normalAdvance, 1.8, "[10] 同一初相位下 Ultra boost 相位推进快 1.8×");
  eq(internals.createStarfieldClock(0).phases().length, 0, "[10] 空星场时钟保持空数组");
  const rafStar = react.findAll("star")[0];
  const transformBeforeRaf = rafStar.style.transform;
  ctx10.flushFrames(2, 16);
  ok(rafStar.style.transform !== transformBeforeRaf, "[10] 原生 rAF 帧直接更新星星 transform");
  // ── C：高度 = 随机排列的等距槽位，且与相位**解耦**（不能排成一条斜线）
  const heights = internals.PARTICLES.map((p) => p.y);
  const phases = internals.PARTICLES.map((p) => p.phase);
  eq(new Set(heights.map((y) => y.toFixed(4))).size, internals.PARTICLES.length, "[10] C：22 颗星的高度互不重合");
  ok(heights.every((y) => y >= 8 && y <= 92), "[10] C：高度铺在 8%~92%（用满轨道高度）");
  // 相关系数：早期版本高度与相位取同一个数 → 实测 0.999，22 颗排成一条斜线（用户反馈"太规整"）
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const mx = mean(phases);
  const my = mean(heights);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < phases.length; i += 1) {
    sxy += (phases[i] - mx) * (heights[i] - my);
    sxx += (phases[i] - mx) ** 2;
    syy += (heights[i] - my) ** 2;
  }
  const corr = sxy / Math.sqrt(sxx * syy);
  ok(Math.abs(corr) < 0.35, `[10] C：高度与相位解耦（相关系数 ${corr.toFixed(3)}，旧版 0.999 = 一条斜线）`);
  // 相位相邻（会一直并排在轨道上走）的两颗，高度必须拉开
  const order = internals.PARTICLES.map((p, i) => ({ i, phase: p.phase })).sort((a, b) => a.phase - b.phase).map((o) => o.i);
  let minNeighbourGap = Infinity;
  for (let k = 1; k < order.length; k += 1) {
    minNeighbourGap = Math.min(minNeighbourGap, Math.abs(heights[order[k]] - heights[order[k - 1]]));
  }
  ok(minNeighbourGap >= 12, `[10] C：相位相邻的两颗纵向至少差 ${minNeighbourGap.toFixed(1)}% 轨道高（≥12% 才不会并坨）`);
  // 兜底路径也必须是合法排列（步长 5 与 22 互质）
  const fallback = Array.from({ length: 22 }, (_, i) => (i * 5) % 22);
  eq(new Set(fallback).size, 22, "[10] C：兜底排列确实是 22 个互不相同的槽");
  ok(internals.CSS.indexOf("will-change:transform,opacity") > 0, "[10] 星星 transform/opacity 由直接渲染更新");
  const starCss = internals.CSS.slice(internals.CSS.indexOf(".ces-star{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-star{")));
  ok(starCss.indexOf("left:0;right:0") > 0, "[10] 星空轨道 = 整条轨道宽（横穿）");

  const brightness = react.findAll("particle").map((node) => Number(node.getAttribute("data-brightness")));
  eq(brightness.length, internals.PARTICLES.length, "[10] 每颗星星都有亮度");
  ok(brightness.every((b) => b >= 0.5 && b <= 1), "[10] 亮度都在 0.5~1 之间（1 = 现在的大小与亮度）");
  ok(new Set(brightness).size > 3, "[10] 亮度是随机的（不是一个值）");
  ok(Math.min(...brightness) < 0.7 && Math.max(...brightness) > 0.9, `[10] 亮度铺开到两端（${Math.min(...brightness).toFixed(2)}~${Math.max(...brightness).toFixed(2)}）`);
  ok(internals.starBrightnessFor(0) === internals.starBrightnessFor(0), "[10] 亮度是确定性的（同一 index 结果一致）");
  const another = await setup();
  await pressAndSettle(another, 300);
  eq(
    JSON.stringify(another.react.findAll("particle").map((n) => Number(n.getAttribute("data-brightness")))),
    JSON.stringify(brightness),
    "[10] 换一次渲染亮度序列完全一致（没有 Math.random）",
  );
  const positions = react.findAll("star").map((n) => Number(/translate3d\((-?[\d.]+)%/.exec(n.style.transform)?.[1] ?? NaN));
  ok(positions.every(Number.isFinite), "[10] 初始星位使用有效 transform");
  ok(new Set(positions.map((p) => p.toFixed(1))).size > 8, "[10] 初始相位铺开（均匀穿流）");

  // ── 拖回 High：映射档位保持蓝色静态
  track(react).fire("onPointerMove", { clientX: internals.KNOB_RADIUS + H * (300 - 2 * internals.KNOB_RADIUS), buttons: 1 });
  await runFrames(ctx10);
  await settle();
  eq(react.find("root").getAttribute("data-energy"), "0", "[10] 拖到 High：紫色能量关闭");
  eq(react.findAll("particle").length, 0, "[10] 拖到 High：无紫色粒子");
  eq(react.findAll("star").length, 0, "[10] 拖到 High：无星场");
  track(react).fire("onPointerUp", {});
  await settle();

  eq(JSON.stringify(internals.PARTICLES), JSON.stringify(internals.PARTICLES), "[10] 粒子参数每次一致");
  ok(CODE.indexOf("Math.random") < 0, "[10] 代码里没有 Math.random");
  ok(SOURCE.indexOf("requestAnimationFrame(tick)") > 0, "[10] 星尘使用局部 rAF 驱动");
  ok(host.selects.length >= 1, "[10] 这一段的所有拖动都真的写回了宿主");

  // A real in-between drag must show eased energy, then return to blue at Max.
  const transition = await setup({ host: { effort: "max" } });
  transition.internals.writeSettings({ motion: "full" });
  await settle();
  track(transition.react, 0, 300);
  await pressOnly(transition, 250);
  await runFrames(transition, 5);
  const intermediateEnergy = Number(transition.react.find("root").style["--ces-energy"]);
  ok(intermediateEnergy > 0.01 && intermediateEnergy < 1, `[10] 拖进 Max→Ultra 期间能量明显处于中间值（${intermediateEnergy}）`);
  track(transition.react).fire("onPointerUp", {});
  await runFrames(transition);
  await settle();
  eq(transition.react.find("track").getAttribute("aria-valuetext"), "Max (max)", "[10] 回到 Max alias");
  eq(transition.react.find("root").getAttribute("data-energy"), "0", "[10] 回到 Max 后紫色能量完全归零");
}

section("10b. 系统「减少动态效果」下是放缓，不是冻住");
{
  const normal = await setup({ host: { effort: "max" } });
  track(normal.react).fire("onKeyDown", { key: "End" });
  await runFrames(normal);
  await settle();
  const star = normal.react.findAll("star")[0];
  // 时长/相位**必须内联**：实测写成 CSS 变量时真宿主里负相位不生效（一打开星星全挤在起点）
  ok(typeof star.style.transform === "string", "[10b] 星位以 transform 初始内联");
  ok(star.style.animationDuration === undefined && star.style.animationDelay === undefined, "[10b] 星尘不使用 CSS 动画计时");
  ok(normal.internals.CSS.indexOf("animation-duration:var(") < 0 && normal.internals.CSS.indexOf("animation-delay:var(") < 0, "[10b] 样式表里不再用变量传动画计时（那正是相位失效的原因）");
  eq(normal.react.find("root").getAttribute("data-motion"), "full", "[10b] 正常模式标记 full");
  ok(String(normal.react.find("track").getAttribute("title")).indexOf("减少动态效果") < 0, "[10b] 正常模式 title 不提系统设置");

  // ⚠️ 默认已改为「完整动画」（用户要求）：系统即使开着「减少动态效果」，默认也走完整动画。
  //    「快速动画」是**用户可选**的弱化档（其参数组在 19 节覆盖）。
  const reduced = await setup({ reducedMotion: true, host: { effort: "max" } });
  track(reduced.react).fire("onKeyDown", { key: "End" });
  await runFrames(reduced);
  await settle();
  eq(reduced.react.find("root").getAttribute("data-motion"), "full", "[10b] 默认「完整动画」→ 即便系统要求减少动态也标记 full");
  ok(String(reduced.react.find("track").getAttribute("title")).indexOf("减少动态效果") < 0, "[10b] 默认下 title 不加「已放缓」提示");
  eq(reduced.react.findAll("star").length, 22, "[10b] Ultra 星空照常存在");
  eq(reduced.react.findAll("star")[0].style.transform, star.style.transform, "[10b] 默认完整动画下初相位与系统 reduced-motion 无关");
  ok(reduced.internals.REDUCED_MOTION_SLOWDOWN > 1, "[10b] 「快速动画」档所用的放缓系数仍在（>1）");

  const css = reduced.internals.CSS;
  ok(css.indexOf(".ces-energy__sweep{display:none}") > 0, "[10b] reduced-motion 收起扫光（最闪的那部分）");
  ok(!/\.ces-star\{animation:none\}/.test(css), "[10b] 星尘位置由 JS 相位时钟驱动");
}

section("11. 结构上不存在消息注入（防同类插件的致命 bug）");
{
  const { host, plugin } = await setup();
  eq(host.subscriptions.length, 0, "[11] 没有 ctx.on(...) —— 不监听任何宿主钩子");
  ok(host.registered.length === 1, "[11] 只做了一件事：注册一个插槽条目");
  ok(CODE.indexOf("session.append") < 0 && CODE.indexOf(".append(") < 0, "[11] 代码里没有任何会话 append（除了给那一行 append 容器）");
  ok(CODE.indexOf('role: "user"') < 0 && CODE.indexOf('"user/message"') < 0, "[11] 不构造 user 消息");
  ok(CODE.indexOf("producer-owned") < 0, "[11] 不触碰 V4 会话准入面");
  ok(typeof plugin.apply === "function" && typeof plugin.inject !== "undefined", "[11] 导出面只有 apply/inject");
}

section("12. DOM 锚点契约（官方产物里必须还存在我依赖的语义属性）");
{
  const candidates = [
    "F:/Work Space/DeepSeek Harness/_review/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js",
  ];
  const official = candidates.find((path) => existsSync(path));
  if (official === undefined) {
    console.log("  --   跳过：本机没有解包出来的官方产物（_review/dsh-asar）");
  } else {
    const text = readFileSync(official, "utf8");
    ok(text.indexOf('"aria-haspopup": "menu"') > 0, "[12] 官方席仍然有 aria-haspopup=menu");
    ok(text.indexOf('"aria-expanded": open') > 0, "[12] 官方席仍然有 aria-expanded");
    ok(text.indexOf("aria-controls") > 0 && text.indexOf("-menu`") > 0, "[12] 官方席仍然用 aria-controls 指向菜单 id");
    ok(text.indexOf('role: "menuitem"') > 0, "[12] 根面板两行仍然是 role=menuitem");
    ok(text.indexOf('"menu.effort": "推理等级"') > 0, "[12] 官方中文文案仍然是「推理等级」");
    ok(text.indexOf('role: "menuitemradio"') > 0, "[12] 子面板仍然是 menuitemradio（我的结构判定靠这个区分）");
    ok(text.indexOf('window.addEventListener("resize", place)') > 0, "[12] 官方菜单在 resize 时会重测位置（我加高后靠它重排）");
  }
}

section("13. 宿主半边（lib/index.js）");
{
  const hostPath = fileURLToPath(new URL("../lib/index.js", import.meta.url));
  const mod = await import(pathToFileURL(hostPath).href + `?t=${Date.now()}`);
  let threw = false;
  try {
    mod.apply({});
    mod.apply(undefined);
    mod.apply({ logger: () => { throw new Error("logger boom"); } });
    mod.apply({ logger: { info() { throw new Error("sink boom"); } } });
    mod.apply(null);
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[13] 宿主半边在任何畸形 ctx 下都不抛错（绝不连累插件树）");
  ok(mod.inject === undefined || Array.isArray(mod.inject) === false, "[13] 宿主半边不声明服务（避免 fiber 停在 PENDING）");
}

section("14. 官方数值文字（Ultra / High）的颜色");
{
  const ctx14 = await setup();
  const { react, internals, menu } = ctx14;
  const H = internals.ENERGY_END;
  // 只改颜色，一个字的文字都不碰
  eq(menu.effortValueEl.textContent, "High", "[14] 文字内容没被动过");
  eq(menu.effortValueEl.style.color, "rgb(77,127,247)", "[14] High 档：官方数值文字保持蓝色");
  ok(!menu.effortLabelEl.style.color, "[14] 官方标签（推理等级）的颜色不动");
  ok(!menu.modelValueEl.style.color, "[14] 另一行（模型）的数值颜色不动 —— 只碰推理等级那一行");

  // 颜色随位置走：蓝 → 紫罗兰
  eq(internals.valueColorFor(0), "rgb(77,127,247)", "[14] 最左端 = 蓝");
  eq(internals.valueColorFor(1), "rgb(139,92,246)", "[14] 最高档 = 紫罗兰（不是看不见的深紫，也不是发虚的亮紫）");
  const rgb = (s) => s.match(/\d+/g).map(Number);
  const low = rgb(internals.valueColorFor(0));
  const mid = rgb(internals.valueColorFor(H));
  const top = rgb(internals.valueColorFor(1));
  ok(mid[0] > low[0] && top[0] > mid[0], "[14] 红色分量单调上升（越往右越紫）");
  ok(top[1] < low[1], "[14] 绿色分量下降（紫比蓝更冷）");
  // 可读性：对白底与对深色底（#1b1c20）都要够，这条以后能挡住"挑了个看不见的颜色"
  const luminance = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const WHITE = [255, 255, 255];
  const DARK_BG = [27, 28, 32];
  ok(contrast(top, WHITE) >= 3, `[14] 最高档对白底对比度 ${contrast(top, WHITE).toFixed(2)}:1 ≥3（浅色主题读得清）`);
  ok(contrast(top, DARK_BG) >= 3, `[14] 最高档对深色底对比度 ${contrast(top, DARK_BG).toFixed(2)}:1 ≥3（深色主题读得清）`);
  ok(contrast(rgb(internals.valueColorFor(0)), WHITE) >= 3, "[14] 最左端的蓝对白底也够（≥3）");
  const sum = (s) => rgb(s).reduce((a, b) => a + b, 0);
  ok(sum(internals.valueColorFor(1)) > sum(internals.fillColorFor(1)), "[14] 数值颜色比填充末尾的深紫更亮（文字不能用深紫）");
  ok(sum(internals.valueColorFor(1)) > sum(internals.valueColorFor(H)), "[14] 最高档比 high 更亮（越往右越通电）");

  // 拖到 Ultra → 文字变成紫罗兰
  await pressAndSettle(ctx14, 300);
  eq(menu.effortValueEl.style.color, "rgb(139,92,246)", "[14] 拖到 Ultra：文字直接变紫罗兰");
  eq(menu.effortValueEl.textContent, "High", "[14] 文字内容仍然由官方自己管（没被我们改写）");

  // 关掉菜单 → 还原成原来的内联颜色（通常是空）
  const { menu: menu3, bundle } = await setup();
  eq(menu3.effortValueEl.style.color, "rgb(77,127,247)", "[14] 关之前 High 仍显示蓝色（前置条件）");
  menu3.close();
  bundle.flushObservers(); // 生产里靠 MutationObserver 触发（settle 不会跑它）
  await settle();
  ok(!menu3.effortValueEl.style.color, "[14] 菜单关闭后颜色被还原（不把改动留在官方节点上）");
  eq(menu3.effortValueEl.textContent, "High", "[14] 还原的是颜色，文字始终是官方自己的");

  // 认不出 class 时退到结构判定：最后一个有文字的 span
  const again = await setup();
  const valueEl = again.menu.effortValueEl;
  valueEl.className = "";
  eq(internals.findValueElement(again.menu.effortRow), valueEl, "[14] class 认不出时退到结构判定（最后一个有文字的 span）");
  ok(internals.findValueElement(null) === null, "[14] 传 null 不抛错");
}

section("15. 收起态模型席按钮上的档位（点开之前就看得见）");
{
  const H = 2 / 3;
  // 关键场景：菜单**没打开**（aria-expanded=false）—— 滑条此时不注入，但席上的档位文字照样着色
  const closed = await setup({ menu: { open: false } });
  eq(closed.menu.seatEffortEl.textContent, "High", "[15] 席按钮上的档位文字没被动过");
  eq(closed.menu.seatEffortEl.style.color, "rgb(77,127,247)", "[15] 收起态 High 保持蓝色");
  ok(!closed.menu.seatLabelEl.style.color, "[15] 席上的模型名（DeepSeek-V41-Flash）颜色不动");
  eq(closed.menu.seatLabelEl.textContent, "DeepSeek-V41-Flash", "[15] 模型名文字没被动过");
  ok(closed.react.find("track") === null, "[15] 菜单没打开时不注入滑条（前置条件，说明上面那条不是靠滑条生效的）");

  // 打开菜单后：拖动改档位 → 菜单里的数值跟着草稿、席上的档位跟已生效
  const ctx15 = await setup();
  const { react, internals, menu, bundle, document } = ctx15;

  // 拖动中：官方席显示的是**已生效**档位，所以它的颜色不该跟着草稿跑
  await pressAndSettle(ctx15, 300);
  eq(menu.effortValueEl.style.color, "rgb(139,92,246)", "[15] 菜单里那一行跟着草稿变成 Ultra 色");
  eq(menu.seatEffortEl.style.color, "rgb(77,127,247)", "[15] 席按钮仍按已生效 High 蓝色显示（拖动中不乱跳）");
  await releaseAndSettle(ctx15);
  eq(menu.seatEffortEl.style.color, "rgb(139,92,246)", "[15] 提交后席按钮跟上 Ultra 色");
  eq(menu.seatEffortEl.textContent, "High", "[15] 文字仍然由官方自己管（我们只改颜色）");

  // 官方重渲染换了那个节点 → 桥要重新抓到并补色
  const oldEl = menu.seatEffortEl;
  const parent = oldEl.parentNode;
  parent.removeChild(oldEl);
  const newNode = document.createElement("span");
  newNode.className = "wq12jW_triggerEffort";
  newNode.textContent = "High";
  parent.appendChild(newNode);
  bundle.flushObservers();
  await settle();
  eq(newNode.style.color, "rgb(139,92,246)", "[15] 官方换了节点后，新节点也被着色（桥重新抓取）");
  eq(oldEl.style.color ?? "", "", "[15] 旧节点被还原后才放手（不留改动）");

  // 卸载组件 → 还原席按钮的颜色
  react.unmount();
  await settle();
  eq(newNode.style.color ?? "", "", "[15] 组件卸载后席按钮颜色被还原");

  // 认文字：给错的名字就不动（fail-open，绝不误伤别的文字）
  const other = await setup();
  ok(internals.findSeatEffort(other.document, other.menu.composer, "Max") === null, "[15] 名字对不上就返回 null（不猜、不乱改）");
  ok(internals.findSeatEffort(other.document, other.menu.composer, "") === null, "[15] 名字为空也不动");
  ok(internals.findSeatEffort(null, other.menu.composer, "High") === null, "[15] 传 null 不抛错");
  eq(internals.findSeatEffort(other.document, other.menu.composer, "DeepSeek-V41-Flash"), other.menu.seatLabelEl, "[15] 按文字精确命中（模型名也认得出来，但我们只用档位名）");
}

section("16. Off 档保持官方灰 + 刻度点更小更淡");
{
  const { internals } = await setup();
  const OFF = { id: "off", name: "Off" };
  const LOW = { id: "low", name: "Low" };
  // 判定：id 与 name 都认，大小写/空格不敏感，认不出就算普通档位（照常着色）
  ok(internals.isOffLevel(OFF), "[16] id/name 为 off 的档位被认出来");
  ok(internals.isOffLevel({ id: "OFF" }), "[16] 大小写不敏感");
  ok(internals.isOffLevel({ name: "  off " }), "[16] 空格不敏感");
  ok(internals.isOffLevel({ name: "关闭" }), "[16] 中文同义写法也认");
  ok(!internals.isOffLevel(LOW), "[16] Low 不是 off 档");
  ok(!internals.isOffLevel(null) && !internals.isOffLevel(undefined), "[16] 空值不误判");
  // 颜色：off 档给空串 = 不写内联色 = 官方原本的灰
  eq(internals.valueColorFor(0, OFF), "", "[16] off 档 → 空串（不写内联色，保持官方灰）");
  eq(internals.valueColorFor(0, LOW), "rgb(77,127,247)", "[16] 首档不是 off（比如只有 Low/High/Max）时照常给蓝");
  eq(internals.valueColorFor(1, OFF), "", "[16] 即便位置在最右，只要档位是 off 就是灰的");

  // 真场景：当前档位 = off，且席按钮上也写着 Off
  const off = await setup({ host: { effort: "off" }, menu: { effortLabel: "Off" } });
  eq(off.react.find("root").getAttribute("data-energy"), "0", "[16] off 档没有能量层（纯蓝、无星云无粒子）");
  eq(off.react.findAll("particle").length, 0, "[16] off 档没有粒子");
  eq(off.menu.effortValueEl.style.color, "", "[16] 菜单里那一行的数值文字：灰（不写内联色）");
  eq(off.menu.seatEffortEl.style.color, "", "[16] 收起态席按钮上的档位文字：灰（不写内联色）");
  eq(off.menu.effortValueEl.textContent, "Off", "[16] 文字内容仍然是官方的");
  ok(!off.menu.seatLabelEl.style.color, "[16] 模型名依旧不动");
  // 拖到 Max 就恢复着色（确认"灰"只发生在 off 档）
  await pressAndSettle(off, 300);
  eq(off.menu.effortValueEl.style.color, "rgb(139,92,246)", "[16] 拖到最右 Ultra：文字变紫罗兰");
  eq(off.menu.seatEffortEl.style.color, "", "[16] 席按钮按已生效档位（仍是 off）→ 还是灰的");
  await releaseAndSettle(off);
  eq(off.menu.seatEffortEl.style.color, "rgb(139,92,246)", "[16] 提交后 Ultra 席按钮变紫罗兰");

  // 刻度点：更小更淡
  const tickCss = internals.CSS.slice(internals.CSS.indexOf(".ces-tick{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-tick{")));
  ok(tickCss.indexOf("width:5.4px;height:5.4px") > 0, "[16] 刻度点 = 5.4px（更小）");
  ok(tickCss.indexOf("28%,transparent") > 0, "[16] 未达到刻度使用 28% 低对比度");
  ok(internals.CSS.indexOf(".ces-tick[data-on='1']{background:rgba(255,255,255,.5)}") > 0, "[16] 已达刻度 92% → 50% 白（更淡，不再和星星抢眼）");
  const tickNodes = off.react.findAll("tick");
  ok(tickNodes.length >= 4, `[16] 4 档就有 4 个刻度点（实测 ${tickNodes.length}）`);
}

section("16b. 只有 off 档的模型不会启用高能量特效");
{
  const offOnly = {
    id: "off-only-model",
    name: "Off Only",
    reasoning: { defaultEffort: "off", efforts: [{ id: "off", name: "Off" }] },
  };
  const ctx = await setup({ host: { model: offOnly }, menu: { effortLabel: "Off" } });
  eq(ctx.internals.effectsEnabled(offOnly.reasoning.efforts[0], 0, 1), false, "[16b] off-only 模型按档位身份关闭效果");
  eq(ctx.react.find("root").getAttribute("data-energy"), "0", "[16b] off-only 模型 energy 保持关闭");
  eq(ctx.react.findAll("star").length, 0, "[16b] off-only 模型不渲染星尘");
  eq(ctx.host.selects.length, 0, "[16b] 仅显示模型默认档位，不产生宿主提交");
}

/* ══════════════════════════════════════════════════════════════════════ */

section("17. 连续运动引擎：纯函数层（刹车预测 + 速度跟踪）");
{
  const ctx = await setup();
  const I = ctx.internals;
  const P = I.MOTION;
  const DT = 1 / 60;

  /** 跑一串帧，返回轨迹与统计。 */
  function trace(init, frames, mutate) {
    const m = Object.assign({ x: 0, v: 0, a: 0, target: 0 }, init);
    const rows = [];
    let maxDv = 0, prevV = m.v, maxDa = 0, prevA = m.a;
    for (let f = 0; f < frames; f += 1) {
      if (mutate) mutate(m, f);
      I.motionStep(m, DT, P);
      maxDv = Math.max(maxDv, Math.abs(m.v - prevV));
      maxDa = Math.max(maxDa, Math.abs(m.a - prevA));
      prevV = m.v; prevA = m.a;
      rows.push({ x: m.x, v: m.v, a: m.a, target: m.target });
    }
    return { m, rows, maxDv, maxDa };
  }

  /** 从静止走到 target，跑到精确落点（或超时）；同时统计 v 的符号翻转（抖振）。 */
  function run(target, maxFrames = 3000) {
    const m = { x: 0, v: 0, a: 0, target };
    let peak = 0, frames = 0, flips = 0, prevSign = 0;
    for (; frames < maxFrames; frames += 1) {
      I.motionStep(m, DT, P);
      peak = Math.max(peak, m.x);
      const s = Math.sign(m.v);
      if (s !== 0 && prevSign !== 0 && s !== prevSign) flips += 1;
      if (s !== 0) prevSign = s;
      if (m.x === target && m.v === 0) break;
    }
    return { m, frames, overshoot: peak - target, flips, landed: m.x === target && m.v === 0 };
  }

  // ① 参数：四个旋钮都是正数
  ok(P.K > 0, `[17] 位置→速度增益 K = ${P.K} > 0`);
  ok(P.A > 0, `[17] 刹车斜率 A = ${P.A} > 0`);
  ok(P.k > 0, `[17] 速度跟踪增益 k = ${P.k} > 0`);
  ok(P.vmax > 0, `[17] 速度上限 vmax = ${P.vmax} > 0`);

  // ② ⚠️ **最关键的结构性断言**：两项必须同时存在。
  //    只留刹车曲线 √(2A|e|) 会抖振（它是 bang-bang 的切换曲线，
  //    与恒力 ±A 配套；换成连续力律后必须补线性映射 K·|e|）。
  {
    // 复现"只留刹车曲线"的缺陷版本，确认它确实抖振 —— 防止将来有人把 K 项删掉
    function stepBrakeOnly(m) {
      const e = m.target - m.x;
      let vW = Math.sqrt(2 * P.A * Math.abs(e));
      if (vW > P.vmax) vW = P.vmax;
      const vDes = e > 0 ? vW : (e < 0 ? -vW : 0);
      m.a = Math.max(-P.amax, Math.min(P.amax, P.k * (vDes - m.v)));
      m.v = Math.max(-P.vmax, Math.min(P.vmax, m.v + m.a * DT));
      m.x += m.v * DT;
    }
    const bad = { x: 0, v: 0, a: 0, target: 0.5 };
    let flipsBad = 0, prevSign = 0;
    for (let f = 0; f < 600; f += 1) {
      stepBrakeOnly(bad);
      const s = Math.sign(bad.v);
      if (s !== 0 && prevSign !== 0 && s !== prevSign) flipsBad += 1;
      if (s !== 0) prevSign = s;
    }
    ok(flipsBad > 100,
      `[17] 反例确认：只有刹车曲线时 v 翻转 ${flipsBad} 次（抖振不收敛）→ 所以 K·|e| 那一项不能删`);
    // 而正式实现零翻转
    const good = run(0.5);
    ok(good.flips === 0, `[17] 正式实现（含 K·|e|）零抖振（v 翻转 ${good.flips} 次）`);
  }

  // ③ **精确落点 + 零抖振**：所有距离都必须严丝合缝停住
  for (const target of [0.02, 0.05, 0.1, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1]) {
    const r = run(target);
    ok(r.landed && r.flips === 0,
      `[17] 目标 ${target.toFixed(4)} 精确落点且零抖振（${r.frames} 帧，翻转 ${r.flips}）`);
  }

  // ④ 过冲在亚像素级（≤0.5px / 272px）
  {
    const subPixel = 0.5 / 272;
    let worst = 0;
    for (const target of [0.02, 0.1, 0.25, 0.5, 0.75]) worst = Math.max(worst, run(target).overshoot);
    ok(worst < subPixel, `[17] 各距离过冲 ${(worst * 272).toFixed(3)}px < 0.5px（亚像素）`);
  }

  // ⑤ 加速度被 amax 限住，且**不抖振**（这是本模型相对 bang-bang 的核心优势）
  //    ⚠️ 口径说明：以前写过"帧间 Δa ≤ amax·dt"，但那条**对速度跟踪力律不成立** ——
  //       `a = k·(v期望 − v)`，速度差大时 a 就大，一帧内可以变很多（实测 160）。
  //       这不叫不连续：a 是 (x, v) 的**连续函数**，只是 v 自身一帧内变化大。
  //       真正该断言的是：a 始终被 amax 限住 + 在目标附近**不来回翻转**（不抖振）。
  {
    const r = trace({ x: 0, target: 1 }, 200);
    let maxAbsA = 0;
    for (const row of r.rows) maxAbsA = Math.max(maxAbsA, Math.abs(row.a));
    ok(maxAbsA <= P.amax + 1e-9, `[17] 加速度始终被 amax 限住（实测峰值 ${maxAbsA.toFixed(0)} ≤ ${P.amax}）`);

    // 不抖振：目标固定时，a 的符号翻转次数应为 0（bang-bang 会反复翻转）
    const m = { x: 0, v: 0, a: 0, target: 1 };
    let aFlips = 0, prevSign = 0;
    for (let f = 0; f < 300; f += 1) {
      I.motionStep(m, DT, P);
      const s = Math.sign(m.a);
      if (s !== 0 && prevSign !== 0 && s !== prevSign) aFlips += 1;
      if (s !== 0) prevSign = s;
      if (m.x === 1 && m.v === 0) break;
    }
    ok(aFlips <= 1, `[17] 到位过程加速度只换向 ${aFlips} 次（加速→减速；不抖振）`);
  }

  // ⑥ 速度连续（帧间 Δv ≤ amax·dt，撞墙帧除外）
  {
    const r = trace({ target: 1 }, 200);
    const limit = P.amax * DT + 1e-9;
    ok(r.maxDv <= limit, `[17] 帧间 Δv ${r.maxDv.toFixed(3)} ≤ amax·dt ${limit.toFixed(3)}（速度连续）`);
  }

  // ⑦ 反向：**先滑行再掉头**（v 连续穿过 0），滑行距离 ≈ v²/(2A)
  {
    const m = { x: 0, v: 0, a: 0, target: 1 };
    for (let f = 0; f < 200 && m.v < P.vmax * 0.95; f += 1) I.motionStep(m, DT, P);
    const vBefore = m.v, x0 = m.x;
    let sameDirFrames = 0, maxDv = 0, prevV = m.v, slidePx = 0;
    for (let f = 0; f < 200; f += 1) {
      m.target = 0;
      I.motionStep(m, DT, P);
      maxDv = Math.max(maxDv, Math.abs(m.v - prevV)); prevV = m.v;
      if (m.v > 0) { sameDirFrames += 1; slidePx = Math.abs(m.x - x0); }
      else break;
    }
    ok(vBefore > P.vmax * 0.5, `[17] 前置：反向时确实在满速附近（v=${vBefore.toFixed(2)}）`);
    ok(sameDirFrames >= 1, `[17] 满速反向后有 ${sameDirFrames} 帧仍朝原方向滑行（v 连续穿过 0）`);
    ok(maxDv <= P.amax * DT + 1e-9, `[17] 反向过程 v 依然连续（最大 Δv ${maxDv.toFixed(3)}）`);
    // 滑行距离由 A 决定（这是 A 这个旋钮的物理含义）
    const theory = (vBefore * vBefore) / (2 * P.A);
    ok(slidePx <= theory * 272 * 1.6 + 1,
      `[17] 反向滑行 ${(slidePx * 272).toFixed(1)}px ≈ v²/2A ${(theory * 272).toFixed(1)}px（A 越大越"立即听话"）`);
  }

  // ⑧ 边界：位置夹在 [0,1]；非撞墙帧 Δv ≤ amax·dt
  {
    for (const target of [-0.5, 1.5]) {
      const m = { x: 0.5, v: 0, a: 0, target };
      let maxDvNonWall = 0, prevV = m.v;
      for (let f = 0; f < 200; f += 1) {
        const before = m.x;
        I.motionStep(m, DT, P);
        const dv = Math.abs(m.v - prevV);
        const hitWall = (m.x === 0 && before > 0 && m.v === 0) || (m.x === 1 && before < 1 && m.v === 0);
        if (!hitWall) maxDvNonWall = Math.max(maxDvNonWall, dv);
        prevV = m.v;
      }
      ok(m.x >= 0 && m.x <= 1, `[17] 目标 ${target}：位置被夹在 [0,1]（实测 ${m.x.toFixed(4)}）`);
      ok(maxDvNonWall <= P.amax * DT + 1e-9,
        `[17] 目标 ${target}：非撞墙帧 Δv ${maxDvNonWall.toFixed(3)} ≤ amax·dt`);
    }
  }

  // ⑨ 极小距离也精确落点
  {
    for (const target of [0.001, 0.005, 0.01]) {
      const r = run(target);
      ok(r.landed, `[17] 极小距离 ${target} 精确落点（${r.frames} 帧）`);
    }
  }

  // ⑩ 松手外推：速度的连续函数，无门槛
  {
    eq(I.releaseIndexFor(0.5, 0, 4), I.indexFromPct(0.5, 4), "[17] 速度为 0 → 外推量为 0（不改落点）");
    eq(I.RELEASE_PROJECT_S, 0, "[17] 灵敏度已关闭（诊断结论：非零外推会跨档 → 抽搐）");
    ok(I.indexFromPct(0.5 + 6 * 0.08, 4) >= I.indexFromPct(0.5, 4), "[17] 外推顺着运动方向（不会反向推）");
  }
}

section("18. 连续运动引擎：接线层（按下/拖动/松手/键盘只改目标）");
{
  // ① 按下不瞬移：按下后**不泵帧**，位置应停在原处（引擎还没走）
  {
    const ctx = await setup();
    const before = ctx.react.find("knob").style.left;
    track(ctx.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
    for (let m = 0; m < 6; m += 1) await Promise.resolve();
    const after = ctx.react.find("knob").style.left;
    eq(after, before, "[18] 按下瞬间**不瞬移**（位置停在原处，等引擎追过去）");
  }

  // ② 逐帧推进：位置单调逼近目标，且单帧位移有界（永不跳变）
  {
    const ctx = await setup();
    const I = ctx.internals;
    /** 从 calc(14px + <pct> * (100% - 28px)) 里取出 pct。 */
    const pctOf = (css) => {
      const m = /\+ ([\d.]+) \*/.exec(String(css));
      return m === null ? null : Number(m[1]);
    };
    track(ctx.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
    let prev = pctOf(ctx.react.find("knob").style.left);
    ok(prev !== null, "[18] 位置是 calc() 形式（能解析出 pct）");
    let maxJump = 0;
    const seen = [];
    for (let f = 0; f < 30; f += 1) {
      ctx.flushFrames(1, 16);
      for (let m = 0; m < 6; m += 1) await Promise.resolve();
      const now = pctOf(ctx.react.find("knob").style.left);
      maxJump = Math.max(maxJump, Math.abs(now - prev));
      prev = now;
      seen.push(now);
    }
    const jumpLimit = I.MOTION.vmax * (16 / 1000) + 0.01;
    ok(maxJump <= jumpLimit, `[18] 单帧位移 ${(maxJump * 100).toFixed(2)}% ≤ vmax·dt ${(jumpLimit * 100).toFixed(2)}%（永不跳变）`);
    ok(seen[seen.length - 1] > seen[0], "[18] 位置逐帧在推进（引擎在工作）");
  }

  // ③ 松手：写回发生在**松手瞬间**，且落点 = 外推后的档位
  {
    const ctx = await setup();
    const I = ctx.internals;
    await pressOnly(ctx, 300);
    const selectsBefore = ctx.host.selects.length;
    track(ctx.react).fire("onPointerUp", {});
    await settle();
    ok(ctx.host.selects.length > selectsBefore, "[18] 松手立即写回（不等待吸附动画跑完）");
    eq(ctx.host.selects[ctx.host.selects.length - 1].reasoningEffort, "max", "[18] 松手落点 = 外推后的档位（与视觉无关）");
  }

  // ④ 吸附结束后交回 effectivePct（不残留 draft）
  {
    const ctx = await setup();
    await pressAndSettle(ctx, 0);
    await releaseAndSettle(ctx);
    eq(ctx.react.find("knob").style.left, ctx.internals.knobOffsetOf(0), "[18] 吸附完成后精确落在档位点");
    eq(ctx.react.find("track").getAttribute("aria-valuenow"), "0", "[18] 吸附完成后读数 = 落点档位");
  }

  // ⑤ 拖动中"追上指针"后位置停在指针处（不能清掉 draft 跳回已生效档位）
  {
    const ctx = await setup();
    const I = ctx.internals;
    await pressOnly(ctx, 150); // 指针落在中间（不是档位点）
    await runFrames(ctx);
    const pct = (150 - I.KNOB_RADIUS) / (300 - 2 * I.KNOB_RADIUS);
    eq(ctx.react.find("knob").style.left, I.knobOffsetOf(I.clamp01(pct)), "[18] 拖动中追上指针后停在指针处（不跳回档位）");
  }

  // ⑥ 键盘：只改目标，位置连续过去（不瞬移）
  {
    const ctx = await setup();
    const before = ctx.react.find("knob").style.left;
    const trackNode = ctx.react.find("track");
    trackNode.fire("onKeyDown", { key: "Home", preventDefault() {} });
    for (let m = 0; m < 6; m += 1) await Promise.resolve();
    eq(ctx.react.find("knob").style.left, before, "[18] 键盘改档也不瞬移（位置交给引擎）");
    await runFrames(ctx);
    eq(ctx.react.find("knob").style.left, ctx.internals.knobOffsetOf(0), "[18] 键盘目标最终精确到位");
  }

  // ⑦ 卸载后帧循环必须停（否则 setDraft 到已卸载组件）
  {
    const ctx = await setup();
    track(ctx.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
    ctx.flushFrames(1, 16);
    for (let m = 0; m < 6; m += 1) await Promise.resolve();
    ctx.react.unmount();
    const noop = () => null;
    ctx.react.find = noop; // 卸载后若还渲染就会读到 null 而崩
    const executed = ctx.flushFrames(20, 16);
    ok(executed === 0, `[18] 卸载后帧循环已停（继续泵 ${executed} 帧都无人响应）`);
  }
}

section("19. 两种动画模式：简洁 / 完整，且都不受系统「减少动态效果」影响");
{
  const pctOf = (c) => {
    const m = /\+ ([\d.]+) \*/.exec(c.react.find("knob").style.left || "");
    return m ? parseFloat(m[1]) : 0;
  };
  const run = async (c, frames, dt = 16) => {
    for (let i = 0; i < frames; i += 1) {
      const e = c.flushFrames(1, dt);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      if (e === 0) break;
    }
  };

  const ctx = await setup();
  const I = ctx.internals;

  // ① 设置只剩两项（灵敏度/力度已按要求删除）
  eq(I.SETTINGS_SCHEMA.length, 2, "[19] 设置只有两项（动画 + 刻度点）");
  eq(I.SETTINGS_SCHEMA.map((it) => it.key).join(","), "motion,reachedTicks", "[19] 键名正确，力度已删除");
  eq(I.readSettings().motion, "full", "[19] 动画默认 = 完整动画");
  ok(I.SETTINGS_SCHEMA.every((it) => it.default !== undefined), "[19] 每项都显式声明 default");
  eq(I.SETTINGS_SCHEMA[0].options.map((o) => o.label).join("/"), "快速动画/简洁动画/完整动画", "[19] 选项文案与顺序（由上到下：快速 / 简洁 / 完整）");
  eq(I.SETTINGS_SCHEMA[0].group, "动画效果", "[19] 分组标题 = 动画效果（灰色那一行）");

  // ② 两种模式的参数组
  ok(I.motionParamsForMode() === I.MOTION, "[19] 完整动画 → MOTION（他的方案）");
  I.writeSettings({ motion: "quick" });
  ok(I.motionParamsForMode() === I.MOTION_REDUCED, "[19] 简洁动画 → MOTION_REDUCED（我们之前的方案）");
  ok(I.MOTION_REDUCED.K > I.MOTION.K && I.MOTION_REDUCED.vmax > I.MOTION.vmax, "[19] 简洁参数更紧");

  // ③ 灵敏度写死为"他原来的一半"
  ok(I.RELEASE_PROJECT_S === 0, "[19] 灵敏度 = 0（非零外推会把落点推到另一档 → 抽搐）");

  // ④ 系统「减少动态效果」完全不影响行为
  for (const mode of ["full", "quick"]) {
    const a = await setup({ reducedMotion: true });
    a.internals.writeSettings({ motion: mode });
    const b = await setup({ reducedMotion: false });
    b.internals.writeSettings({ motion: mode });
    eq(a.react.find("root").getAttribute("data-motion"), b.react.find("root").getAttribute("data-motion"),
      `[19] ${mode}：系统开关不改变 data-motion`);
    eq(String(a.react.find("track").getAttribute("title")), String(b.react.find("track").getAttribute("title")),
      `[19] ${mode}：系统开关不改变提示文案`);
    const drive = async (c) => {
      track(c.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
      await run(c, 4);
      track(c.react).fire("onPointerMove", { clientX: 260, buttons: 1 });
      await run(c, 12);
      return pctOf(c);
    };
    eq(await drive(a), await drive(b), `[19] ${mode}：逐帧位置与系统设置无关`);
  }

  // ⑤ 刻度点（默认隐藏，可切换）
  eq(I.readSettings().reachedTicks, "highlight", "[19] 刻度点默认 = 亮白显示");
  I.writeSettings({ reachedTicks: "highlight" });
  eq(I.readSettings().reachedTicks, "highlight", "[19] 可切到亮白显示");
  ok(/data-reached-ticks='hidden'/.test(I.CSS), "[19] CSS 含隐藏规则");
  ok(/data-reached-ticks='dim'/.test(I.CSS), "[19] CSS 含同色规则");
  I.writeSettings({ reachedTicks: "hidden" });

  // ⑥ 未按键的 move 不得带动滑条
  {
    const c = await setup();
    track(c.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
    await run(c, 40);
    track(c.react).fire("onPointerUp", {});
    await run(c, 20);
    const before = pctOf(c);
    track(c.react).fire("onPointerMove", { clientX: 100, buttons: 0 });
    await run(c, 6);
    eq(pctOf(c), before, "[19] 松手结束后的无按键 move 不带动滑条");
  }
}

section("20. 指针速度不得冻结（滑块跑到鼠标一侧的回归）");
{
  const ctx = await setup();
  const I = ctx.internals;

  // ── 纯函数层：陈旧衰减 ──
  ok(typeof I.decayPointerSpeed === "function", "[20] 暴露了 decayPointerSpeed（可离线断言）");
  eq(I.decayPointerSpeed(2, 0.001, I.POINTER_STALE_S, I.POINTER_SPEED_TAU), 2,
    "[20] 保鲜期内不衰减（刚发生的 pointermove 有效）");
  eq(I.decayPointerSpeed(2, I.POINTER_STALE_S, I.POINTER_STALE_S, I.POINTER_SPEED_TAU), 2,
    "[20] 恰在保鲜期边界上不衰减");
  {
    const d = I.decayPointerSpeed(2, 0.2, I.POINTER_STALE_S, I.POINTER_SPEED_TAU);
    ok(d < 0.01 && d > 0, `[20] 超时 200ms 后几乎衰减到 0（实测 ${d.toExponential(2)}）`);
  }
  ok(I.decayPointerSpeed(-2, 0.2, I.POINTER_STALE_S, I.POINTER_SPEED_TAU) < 0,
    "[20] 反向速度同样衰减（不会变号）");

  // ── 这个 bug 现在从机理上消失了：vPtr 不再参与运动演化 ──
  // （上一版（弹簧阻尼 + 前馈）里 vPtr 是前馈项 2ζω(vPtr−v) 的输入，冻结会把它
  //   变成一个恒定的力，让滑块永久偏在鼠标一侧 13.33%。本版运动律只看 x 与 v，
  //   不含前馈项，所以那一整类问题从机理上不存在。）
  // 但 vPtr 仍被"松手外推"使用，所以衰减本身必须保留（见上面几条）。
  {
    const P = I.MOTION;
    // 运动演化**完全不看 vPtr**：给一个巨大的 vPtr 也不影响结果
    const a = { x: 0.5, v: 0, a: 0, target: 0.8, vPtr: 0 };
    const b = { x: 0.5, v: 0, a: 0, target: 0.8, vPtr: 99 };
    for (let f = 0; f < 200; f += 1) { I.motionStep(a, 1 / 60, P); I.motionStep(b, 1 / 60, P); }
    ok(a.x === b.x && a.v === b.v,
      `[20] 运动演化与 vPtr 无关（本版无前馈项）：两者终点都是 ${a.x.toFixed(4)}`);
    ok(a.x === 0.8, "[20] 且精确落在目标（不再被冻结的速度推偏）");
  }

  // ── 接线层：真实的"指针移动 → 停住"必须停在指针处 ──
  {
    const c = await setup();
    const W = 300;
    const pctOf = (css) => { const m = /\+ ([\d.]+) \*/.exec(String(css)); return m === null ? null : Number(m[1]); };
    const readPct = () => pctOf(c.react.find("knob").style.left);
    const at = (pct) => I.KNOB_RADIUS + pct * (W - 2 * I.KNOB_RADIUS);

    // 按下并追到位
    track(c.react).fire("onPointerDown", { clientX: at(0.20), pointerId: 1 });
    for (let f = 0; f < 120; f += 1) {
      const e = c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      if (e === 0) break;
    }
    near(readPct(), 0.20, "[20] 前置：按下召唤追到位", 1e-3);

    // 连续 pointermove 向右扫（模拟 60Hz）
    let lastPct = 0.20;
    for (let step = 1; step <= 25; step += 1) {
      c.advanceClock(16);
      lastPct = 0.20 + step * 0.02;
      track(c.react).fire("onPointerMove", { clientX: at(lastPct) });
      c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
    }

    // 指针停住：不再有任何 pointermove。**手指仍按着**，所以循环应当常驻
    // （这正是修掉"拖动时瞬间卡顿"的做法：追平后不停循环，避免重启第一帧白费）。
    let framesAfterStop = 0;
    for (let f = 0; f < 90; f += 1) {
      const e = c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      if (e === 0) break;
      framesAfterStop += 1;
    }
    await settle();

    const finalPct = readPct();
    const offset = finalPct - lastPct;
    ok(Math.abs(offset) < 0.01,
      `[20] 指针停住后滑块停在指针处（偏移 ${(offset * 100).toFixed(3)}%，旧代码是 +13.33%）`);
    ok(framesAfterStop >= 80,
      `[20] 拖动中（手指未松）帧循环**保持常驻**（跑了 ${framesAfterStop} 帧）—— 避免重启第一帧白费`);

    // 真正该"停"的时机：松手之后
    track(c.react).fire("onPointerUp", {});
    let framesAfterRelease = 0;
    let stableFrames = 0;
    let previousAfterRelease = readPct();
    for (let f = 0; f < 400; f += 1) {
      const e = c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      framesAfterRelease += 1;
      const currentAfterRelease = readPct();
      stableFrames = Math.abs(currentAfterRelease - previousAfterRelease) < 1e-8 ? stableFrames + 1 : 0;
      previousAfterRelease = currentAfterRelease;
      if (stableFrames >= 5) break; // starfield keeps its own rAF alive after slider motion settles
    }
    ok(stableFrames >= 5 && framesAfterRelease < 300,
      `[20] 松手后滑块运动在星场持续 rAF 的背景下收敛（${framesAfterRelease} 帧）`);
    near(readPct(), 2 / 3, "[20] 松手后吸附到最近档位", 0.03);
  }

  // ⚠️ 拖动中段不能有"该动没动"的帧 —— 这是"瞬间卡顿"的回归断言。
  //    旧代码在拖动中"追上指针"就停循环，下一个 pointermove 再 startFrames()，
  //    而 startFrames 会重置时间基准 → 重启第一帧 dt≈0 → **那一帧位移为 0**
  //    （实测：指针只挪 0.5% 后循环 7 帧就停；重启第 1 帧位移 0.0000%、
  //      第 2 帧才 0.2100%）。慢拖最容易触发，所以用户体感是"偶尔卡一下"。
  {
    const c = await setup();
    const W = 300;
    const pctOf = (css) => { const m = /\+ ([\d.]+) \*/.exec(String(css)); return m === null ? null : Number(m[1]); };
    const readPct = () => pctOf(c.react.find("knob").style.left);
    const at = (pct) => c.internals.KNOB_RADIUS + pct * (W - 2 * c.internals.KNOB_RADIUS);

    // 按下并追到位
    track(c.react).fire("onPointerDown", { clientX: at(0.1), pointerId: 1 });
    for (let f = 0; f < 400; f += 1) {
      const e = c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      if (e === 0) break;
    }

    // 匀速慢拖 40 帧（每帧指针走 0.4% ≈ 1px，最容易触发"追平→停循环"）
    const jumps = [];
    let prev = readPct();
    for (let f = 0; f < 40; f += 1) {
      c.advanceClock(16);
      const want = 0.1 + (f + 1) * 0.004;
      track(c.react).fire("onPointerMove", { clientX: at(want) });
      c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      const now = readPct();
      jumps.push(now - prev);
      prev = now;
    }
    const stalled = jumps.filter((d) => Math.abs(d) < 1e-7).length;
    const maxJump = Math.max(...jumps);
    const minJump = Math.min(...jumps);
    ok(stalled === 0, `[20] 慢拖 40 帧里没有"该动没动"的帧（停滞 ${stalled} 帧）`);
    ok(minJump > 0, `[20] 每一帧都在推进（最小位移 ${(minJump * 100).toFixed(4)}%）`);
    ok(maxJump < minJump * 4 + 1e-9,
      `[20] 位移均匀：最大 ${(maxJump * 100).toFixed(4)}% / 最小 ${(minJump * 100).toFixed(4)}% = ${(maxJump / minJump).toFixed(2)}× < 4×`);
  }

  // ── 松手外推不被污染的 vPtr 带偏 ──
  {
    // 指针停住 → vPtr 已衰减到 ~0 → 外推量 ~0（不该多跳一档）
    const decayed = I.decayPointerSpeed(3, 0.2, I.POINTER_STALE_S, I.POINTER_SPEED_TAU);
    ok(decayed * I.RELEASE_PROJECT_S < 0.002,
      `[20] 指针停住后的松手外推 ≈0（残留 ${(decayed * I.RELEASE_PROJECT_S * 100).toFixed(3)}% 行程），不会多跳一档`);
  }
}

section("21. 官方菜单改档后，引擎必须跟随（防瞬移）");
{
  // 复现用户报的 bug：滑块拖到 max → 官方菜单选 low → 在滑块里点 max → 瞬移到 max。
  //
  // 根因：官方菜单是 pane 状态机（root/model/effort），点进"推理等级"后 root 那一块
  // 被替换、滑条不渲染；选完档位回来时 effectivePct 已变，而引擎 x 只被"滑条自己的
  // 操作"更新 —— 它不知道官方改了档位。
  // 于是点 max 时 target=1.0 而 x 已=1.0 → 一帧内 settled → 显示从 1/3 跳成 1.0。
  //
  // 用 host.store.set 模拟官方那条改档路径（真机里就是 ModelSelect 的 submit）。
  const W = 300;
  const pctOf = (css) => { const m = /\+ ([\d.]+) \*/.exec(String(css)); return m === null ? null : Number(m[1]); };

  async function scene21() {
    const document = createDocument();
    const menu = createOfficialMenu(document, {});
    const bundle = loadBundle(BUNDLE, document, {});
    const host = createFakeHost({});
    bundle.plugin.apply(host.ctx);
    bundle.react.mount(host.registered[0].Component, { sessionId: "session-abcdef" }, menu.composer);
    await settle();
    const react = bundle.react;
    return {
      bundle, host, menu, react,
      track: () => { const n = react.find("track"); if (n) n.rect = { left: 0, top: 0, right: W, bottom: 28, width: W, height: 28 }; return n; },
      readPct: () => pctOf(react.find("knob").style.left),
      at: (pct) => 20 + pct * (W - 40),
      /** 模拟官方菜单改档：直接改共享 store（= ModelSelect 的 submit 效果） */
      officialSelectTo(id) {
        const snap = host.store.getSnapshot();
        host.store.set({ ...snap, current: { ...snap.current, reasoningEffort: id } });
      },
    };
  }
  async function pump21(s, n = 1, dt = 16) {
    for (let i = 0; i < n; i += 1) {
      const e = s.bundle.flushFrames(1, dt);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      if (e === 0) return i;
    }
    return n;
  }
  /** 按一下，返回"第 0 帧后"的位置（必须先落定微任务才能读到新渲染） */
  async function tapFirstFrame(s, pct) {
    const before = s.readPct();
    s.track().fire("onPointerDown", { clientX: s.at(pct), pointerId: 1 });
    for (let k = 0; k < 6; k += 1) await Promise.resolve();
    s.bundle.flushFrames(1, 16);
    for (let k = 0; k < 6; k += 1) await Promise.resolve();
    return { before, after: s.readPct() };
  }

  // ① 用户的确切步骤：拖到 max → 官方选 low → 点 max
  {
    const s = await scene21();
    s.track().fire("onPointerDown", { clientX: s.at(1.0), pointerId: 1 });
    await pump21(s, 200);
    s.track().fire("onPointerUp", {});
    await pump21(s, 200);
    await settle();
    near(s.readPct(), 1.0, "[21] 前置：滑块先拖到 max", 1e-3);

    s.officialSelectTo("low");
    await settle();
    near(s.readPct(), 1 / 6, "[21] 官方选 low 后显示位置跟到 low（七档刻度位于 1/6）", 1e-3);

    const r = await tapFirstFrame(s, 1.0);
    ok(Math.abs(r.after - r.before) < 0.05,
      `[21] 点 max 不再瞬移（第 0 帧跳变 ${((r.after - r.before) * 100).toFixed(2)}%，修前是 66.67%）`);
    await pump21(s, 40);
    near(s.readPct(), 1.0, "[21] 之后平滑滑到 max", 1e-2);
  }

  // ② 点"当前显示位置"应当完全不动（引擎起点正确的最强证据）
  {
    const s = await scene21();
    s.track().fire("onPointerDown", { clientX: s.at(1.0), pointerId: 1 });
    await pump21(s, 200);
    s.track().fire("onPointerUp", {});
    await pump21(s, 200);
    await settle();
    s.officialSelectTo("low");
    await settle();
    const r = await tapFirstFrame(s, 1 / 6);
    ok(Math.abs(r.after - r.before) < 0.02,
      `[21] 点"显示中的位置"完全不动（第 0 帧跳变 ${((r.after - r.before) * 100).toFixed(2)}%）`);
  }

  // ③ 连续多轮"官方改档 → 滑块操作"都不跳变
  {
    const s = await scene21();
    const ids = ["off", "low", "high", "max"];
    let worst = 0;
    for (let round = 0; round < 4; round += 1) {
      s.track().fire("onPointerDown", { clientX: s.at(1.0), pointerId: 1 });
      await pump21(s, 200);
      s.track().fire("onPointerUp", {});
      await pump21(s, 200);
      await settle();
      s.officialSelectTo(ids[round]);
      await settle();
      const r = await tapFirstFrame(s, s.readPct());
      worst = Math.max(worst, Math.abs(r.after - r.before));
      s.track().fire("onPointerUp", {});
      await pump21(s, 200);
      await settle();
    }
    ok(worst < 0.05, `[21] 连续 4 轮"官方改档 → 滑块操作"最大跳变 ${(worst * 100).toFixed(2)}% < 5%`);
  }

  // ④ ⚠️ 反向保护：修法不能破坏写回（曾把对齐放进 ensureMotion 导致写回变 0 次）
  {
    const s = await scene21();
    s.track().fire("onPointerDown", { clientX: 0, pointerId: 1 });
    for (let i = 1; i <= 60; i += 1) s.track().fire("onPointerMove", { clientX: (i / 60) * 300 });
    s.track().fire("onPointerUp", {});
    await settle();
    ok(s.host.selects.length >= 1 && s.host.selects.length <= 3,
      `[21] 60 次拖动仍正常写回 ${s.host.selects.length} 次（1~3；修法若破坏写回会变 0）`);
    eq(s.host.selects[s.host.selects.length - 1].reasoningEffort, "max", "[21] 最后一次写回的是落点档位");
  }
}

section("22. 松手手感：两种模式都是动过去而不是瞬跳");
{
  const pctOf = (c) => {
    const m = /\+ ([\d.]+) \*/.exec(c.react.find("knob").style.left || "");
    return m ? parseFloat(m[1]) : 0;
  };
  for (const mode of ["full", "quick"]) {
    const c = await setup({ reducedMotion: true });     // 系统开着减少动态，也必须一模一样
    c.internals.writeSettings({ motion: mode });
    track(c.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
    for (let i = 0; i < 6; i += 1) { c.flushFrames(1, 16); for (let k = 0; k < 6; k += 1) await Promise.resolve(); }
    track(c.react).fire("onPointerMove", { clientX: 260, buttons: 1 });
    for (let i = 0; i < 4; i += 1) { c.flushFrames(1, 16); for (let k = 0; k < 6; k += 1) await Promise.resolve(); }
    track(c.react).fire("onPointerUp", {});
    const series = [];
    for (let i = 0; i < 40; i += 1) {
      c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      series.push(pctOf(c));
    }
    let moved = 0;
    let reversals = 0;
    let lastDir = 0;
    for (let i = 1; i < series.length; i += 1) {
      const d = series[i] - series[i - 1];
      if (Math.abs(d) > 0.002) moved += 1;
      const dir = d > 0.002 ? 1 : (d < -0.002 ? -1 : 0);
      if (dir !== 0 && lastDir !== 0 && dir !== lastDir) reversals += 1;
      if (dir !== 0) lastDir = dir;
    }
    if (mode === "full") {
      ok(moved >= 1, `[22] full：松手是"动过去"的（${moved} 帧有位移，不是瞬跳）`);
    } else {
      // 简洁档改成稳定参数后是"几帧到位"（旧的紧参数会 33% 振荡，见 [52]）
      ok(moved >= 2 && moved <= 12, `[22] quick：简洁动画几帧到位且不瞬跳（${moved} 帧有位移）`);
    }
    ok(reversals <= 1, `[22] ${mode}：松手过程中不来回抖（折返 ${reversals} 次）`);
  }
}

section("48. 目录就绪：插件必须声明 remote / remote.session（参考实现事故 #2）");
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const m = src.match(/var inject = \[([^\]]*)\]/);
  ok(!!m, "[48] 找到 inject 声明");
  const list = m ? m[1] : "";
  for (const svc of ["slots", "sessions", "modelDirectories", "remote", "remote.session"]) {
    ok(list.includes(`"${svc}"`), `[48] inject 声明了 ${svc}`);
  }
  ok(/release-abort/.test(src), "[48] 档位列表为空时 endDrag 会中止落点（release-abort 守卫）");
  ok(/!\(levelCountNow > 0\)/.test(src), "[48] 有 levelCountNow > 0 的前置判断（endDrag 读 ref 值）");
}

section("49. 档位列表瞬时为空：用缓存兜底，别中断松手写回（模型更新后的顿挫）");
{
  const I = (await setup()).internals;
  const cache = { key: null, levels: [] };
  const m = (id) => ({ id, name: id.toUpperCase() });

  // 1) 活列表非空 → 原样返回，并写入缓存
  const live1 = [m("low"), m("high")];
  const r1 = I.resolveLevels(live1, "deepseek\u0000m1", cache);
  ok(r1 === live1, "[49] 活列表非空 → 原样返回");
  ok(cache.levels.length === 2 && cache.key === "deepseek\u0000m1", "[49] 同时更新缓存（键 = 模型身份）");

  // 2) 活列表瞬时为空（同一模型）→ 用缓存兜底
  const r2 = I.resolveLevels([], "deepseek\u0000m1", cache);
  ok(r2.length === 2 && r2 === cache.levels, "[49] 同一模型下活列表为空 → 返回缓存（档位不丢）");

  // 3) 模型真的换了 → 不复用旧模型档位
  ok(I.resolveLevels([], "opencode\u0000m2", cache).length === 0, "[49] 模型变了 → 不复用旧模型的档位");

  // 4) 身份未知（state.current 缺失）→ 允许用缓存兜底
  ok(I.resolveLevels([], null, cache).length === 2, "[49] 身份未知 → 仍用缓存兜底");

  // 5) 缓存为空时返回空，不凭空造档位
  ok(I.resolveLevels([], "x\u0000y", { key: null, levels: [] }).length === 0, "[49] 缓存为空 → 返回空（不造假档位）");

  // 6) 缓存被别的模型覆盖后，旧模型回来不误用
  I.resolveLevels([m("max")], "opencode\u0000m2", cache);
  ok(I.resolveLevels([], "deepseek\u0000m1", cache).length === 0, "[49] 缓存被别的模型覆盖 → 旧模型不再命中");
  const cacheA = { key: null, levels: [] };
  const cacheB = { key: null, levels: [] };
  I.resolveLevels([m("high")], "deepseek\u0000shared", cacheA);
  eq(I.resolveLevels([], "deepseek\u0000shared", cacheB).length, 0, "[49] 独立实例的空缓存不读到另一实例的模型档位");
  eq(I.resolveLevels([], "deepseek\u0000shared", cacheA).length, 1, "[49] 缓存只在自己的实例内沿用");
}

section("50. 松手必须用 ref 读最新档位（窗口安全网不能调用首渲染的陈旧闭包）");
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

  ok(/endDragRef\.current = endDrag;/.test(src), "[50] 每次渲染都刷新 endDragRef");
  ok(/typeof endDragRef\.current === "function"\) endDragRef\.current\(event\)/.test(src), "[50] 窗口 pointerup 安全网把原始事件交给最新 endDrag");

  const start = src.indexOf("function endDrag(event)");
  const end = src.indexOf("function onTrackPointerDown");
  ok(start > 0 && end > start, "[50] 能定位 endDrag 函数体");
  const body = src.slice(start, end);
  ok(/levelCountRef\.current/.test(body), "[50] endDrag 通过 levelCountRef 读档位数");
  ok(/levelsRef\.current/.test(body), "[50] endDrag 通过 levelsRef 读档位列表");
  ok(!/if \(!\(levelCount > 0\)\)/.test(body), "[50] endDrag 不再直接比较闭包里的 levelCount（旧 bug 不会回来）");
  ok(/levelsRef\.current = levels;/.test(src), "[50] 每次渲染都刷新 levelsRef");
}

section("51. 快速动画（Codex 手感）：不跟手 + 一档一格 + 约 67ms 吸附");
{
  const I = (await setup()).internals;

  // ① 判定纯函数：前进 1/3、后退 2/3（滞回）
  eq(I.detentTargetIndex(0.30, 0, 4), 0, "[51] 未越过 1/3 档距 → 不动");
  eq(I.detentTargetIndex(0.34, 0, 4), 1, "[51] 越过 1/3 档距 → 进一格");
  eq(I.detentTargetIndex(3.0, 3, 4), 3, "[51] 到顶不越界");
  eq(I.detentTargetIndex(0.34, 1, 4), 1, "[51] 后退需越过 2/3（滞回：0.34 不动）");
  eq(I.detentTargetIndex(0.30, 1, 4), 0, "[51] 后退越过 2/3 → 退一格");
  eq(I.detentTargetIndex(2.2, 0, 4), 2, "[51] 一次拖很远 → 直接跨到最近格");
  eq(I.detentTargetIndex(0.50, 0, 1), 0, "[51] 单档 → 恒为 0");
  eq(I.detentTargetIndex(0.50, 0, 0), 0, "[51] 无档位 → 0");

  // ② 引擎参数：半条轨道 ≈ 67ms，且不过冲
  {
    const m = { x: 0, v: 0, a: 0, target: 0.5 };
    let settledAt = -1;
    let maxX = 0;
    for (let i = 1; i <= 40; i += 1) {
      I.motionStep(m, 1 / 60, I.MOTION_FAST);
      maxX = Math.max(maxX, m.x);
      if (settledAt < 0 && I.motionSettled(m, I.MOTION_FAST)) settledAt = i;
    }
    ok(settledAt > 0 && settledAt <= 8, `[51] 0.5 行程 ${settledAt} 帧内到位（≈${Math.round(settledAt * 16.7)}ms；录屏实测约 67ms）`);
    ok(maxX - 0.5 <= 0.02, `[51] 过冲 ${((maxX - 0.5) * 100).toFixed(2)}% ≤ 2%（无回弹）`);
    near(m.x, 0.5, "[51] 最终精确落在目标", 1e-3);
  }

  // ③ 行为：不跟手 + 一档一格
  {
    const pctOf = (c) => {
      const mm = /\+ ([\d.]+) \*/.exec(c.react.find("knob").style.left || "");
      return mm ? parseFloat(mm[1]) : 0;
    };
    const pump = async (c, n) => { for (let i = 0; i < n; i += 1) { c.flushFrames(1, 16); for (let k = 0; k < 6; k += 1) await Promise.resolve(); } };

    const c = await setup({ reducedMotion: true });
    c.internals.writeSettings({ motion: "fast" });
    for (let k = 0; k < 8; k += 1) await Promise.resolve();

    track(c.react).fire("onPointerDown", { clientX: c.internals.KNOB_RADIUS + (300 - 2 * c.internals.KNOB_RADIUS) / 6, pointerId: 1 }); // low 档中心 → 最近档 index 1
    await pump(c, 24);
    near(pctOf(c), 1 / 6, "[51] 按下后停在 Low 档位格（1/6），而不是指针的 20%（不跟手）", 2e-2);

    track(c.react).fire("onPointerMove", { clientX: 75, buttons: 1 });  // 25%，档内
    await pump(c, 12);
    near(pctOf(c), 1 / 6, "[51] 档内小幅移动 → 旋钮不动（一格一格）", 2e-2);

    track(c.react).fire("onPointerMove", { clientX: 200, buttons: 1 }); // 66.7% → 越过判定线
    let frames = 0;
    for (let i = 0; i < 30; i += 1) {
      c.flushFrames(1, 16);
      for (let k = 0; k < 6; k += 1) await Promise.resolve();
      frames += 1;
      if (Math.abs(pctOf(c) - 2 / 3) < 1e-3) break;
    }
    ok(frames <= 10, `[51] 切档后 ${frames} 帧内吸附到 2/3（≈${Math.round(frames * 16.7)}ms）`);
    near(pctOf(c), 2 / 3, "[51] 落在档位格上（2/3）", 2e-2);
    track(c.react).fire("onPointerUp", {});
    await pump(c, 8);
  }
}

section("52. 三组动画参数都必须稳定（不许 bang-bang 自激振荡）—— issue #12 回归");
{
  const I = (await setup()).internals;
  const sets = [["完整", I.MOTION], ["简洁", I.MOTION_REDUCED], ["快速", I.MOTION_FAST]];

  // ① 硬判据（经验阈值 0.7）：amax × (1/60) ≤ 0.7 × vmax
  //    （1.1.2 的旧简洁参数是 20 vs 20 → 一帧内速度可从 +vmax 翻到 -vmax → 位置每帧摆 ±33% ✗）
  for (const [name, p] of sets) {
    ok(p.amax / 60 <= 0.7 * p.vmax + 1e-9, `[52] ${name}：amax/60=${(p.amax / 60).toFixed(2)} ≤ 0.7·vmax=${(0.7 * p.vmax).toFixed(2)}`);
  }

  // ② 仿真各方向/各距离：单帧位移、过冲、收敛帧数都要达标
  const cases = [[0, 1], [1, 0], [0.3, 0.5], [0.5, 1 / 3]];
  for (const [name, p] of sets) {
    for (const [x0, target] of cases) {
      const m = { x: x0, v: 0, a: 0, target };
      let maxStep = 0;
      let maxOvershoot = 0;
      let settledAt = -1;
      let prev = m.x;
      for (let i = 1; i <= 120; i += 1) {
        I.motionStep(m, 1 / 60, p);
        maxStep = Math.max(maxStep, Math.abs(m.x - prev));
        prev = m.x;
        const over = target > x0 ? m.x - target : target - m.x;
        if (over > maxOvershoot) maxOvershoot = over;
        if (settledAt < 0 && I.motionSettled(m, p)) settledAt = i;
      }
      const tag = `[52] ${name} ${x0}→${target.toFixed(3)}`;
      ok(maxStep <= 0.25, `${tag}：单帧最大位移 ${(maxStep * 100).toFixed(1)}% ≤ 25%（不抽搐）`);
      ok(maxOvershoot <= 0.03, `${tag}：过冲 ${(maxOvershoot * 100).toFixed(2)}% ≤ 3%`);
      ok(settledAt > 0 && settledAt <= 90, `${tag}：${settledAt} 帧内收敛`);
      near(m.x, target, `${tag}：最终精确落点`, 1e-3);
    }
  }

  // ③ 把发病参数写进测试：它必须被判据拦住（说明判据真的能防住这个 bug）
  const BAD = { K: 120, A: 600, k: 200, amax: 1200, vmax: 20 };
  ok(BAD.amax / 60 > 0.5 * BAD.vmax, "[52] 1.1.2 的旧简洁参数不满足稳定判据（正是 issue #12 的根因）");
}

/* ══════════════════════════════════════════════════════════════════════ */

section("53. 指针身份、捕获丢失结算与关闭清理");
{
  // 次指针不能接管拖动、改变目标或结束主指针；未知指针同样不能结算。
  const c = await setup({ host: { effort: "off" } });
  const start = track(c.react);
  start.fire("onPointerDown", { clientX: 300, pointerId: 7 });
  await runFrames(c);
  track(c.react).fire("onPointerDown", { clientX: 0, pointerId: 8 });
  track(c.react).fire("onPointerMove", { clientX: 0, pointerId: 8, buttons: 1 });
  track(c.react).fire("onPointerUp", { pointerId: 8 });
  track(c.react).fire("onPointerCancel", { pointerId: 8 });
  track(c.react).fire("onLostPointerCapture", { pointerId: 8 });
  c.bundle.window.dispatchEvent({ type: "pointerup", pointerId: 8 });
  c.bundle.window.dispatchEvent({ type: "pointercancel", pointerId: 8 });
  track(c.react).fire("onPointerUp", { pointerId: undefined });
  await settle();
  eq(c.host.selects.length, 0, "[53] 次指针和无身份事件均不提交主指针的拖动");
  eq(start.capturedPointer, 7, "[53] 次指针不会释放主指针的捕获");
  track(c.react).fire("onLostPointerCapture", { pointerId: 7 });
  await runFrames(c);
  await settle();
  eq(c.host.selects.length, 1, "[53] 主指针捕获丢失仍结算一次");
  eq(c.host.selects[0]?.reasoningEffort, "max", "[53] 次指针未能把原先的 max 意图改成 off");
  eq(start.capturedPointer, null, "[53] 结算后释放实际捕获节点");
  c.bundle.window.dispatchEvent({ type: "pointerup", pointerId: 7 });
  track(c.react).fire("onPointerUp", { pointerId: 7 });
  track(c.react).fire("onLostPointerCapture", { pointerId: 7 });
  await settle();
  eq(c.host.selects.length, 1, "[53] 随后的窗口、轨道和捕获丢失结束事件不重复提交");
  track(c.react).fire("onPointerDown", { clientX: 0, pointerId: 9 });
  track(c.react).fire("onLostPointerCapture", { pointerId: 7 });
  await settle();
  eq(c.host.selects.length, 1, "[53] 上一次指针的迟到事件不能结束新拖动");
  track(c.react).fire("onPointerUp", { pointerId: 9 });
  await settle();
  eq(c.host.selects[1]?.reasoningEffort, "off", "[53] 结算后可由新指针开始下一次拖动");
  c.react.unmount();

  for (const type of ["pointerup", "pointercancel"]) {
    const c = await setup({ host: { effort: "off" } });
    const node = track(c.react);
    node.setPointerCapture = () => { throw new Error("capture unavailable"); };
    node.fire("onPointerDown", { clientX: 300, pointerId: 11 });
    c.bundle.window.dispatchEvent({ type, pointerId: 12 });
    eq(c.host.selects.length, 0, `[53] ${type} 安全网忽略其他指针`);
    c.bundle.window.dispatchEvent({ type, pointerId: 11 });
    await settle();
    eq(c.host.selects[0]?.reasoningEffort, "max", `[53] 捕获失败时窗口 ${type} 仍结算正确档位`);
    c.react.unmount();
    c.bundle.window.dispatchEvent({ type, pointerId: 11 });
    eq(c.host.selects.length, 1, `[53] 卸载后移除窗口 ${type} 监听器`);
  }

  for (const action of ["escape", "window-escape", "close", "unmount", "model", "reset"]) {
    const c = await setup({ host: { effort: "off" } });
    const node = track(c.react);
    node.fire("onPointerDown", { clientX: 300, pointerId: 21 });
    if (action === "escape") track(c.react).fire("onKeyDown", { key: "Escape" });
    if (action === "window-escape") c.bundle.window.dispatchEvent({ type: "keydown", key: "Escape" });
    if (action === "close") { c.menu.close(); c.bundle.flushObservers(); }
    if (action === "unmount") c.react.unmount();
    if (action === "model") {
      const snapshot = c.host.store.getSnapshot();
      c.host.store.set({ ...snapshot, current: { ...snapshot.current, model: "another-model" } });
    }
    if (action === "reset") c.react.find("reset").fire("onClick", {});
    await settle();
    eq(node.capturedPointer, null, `[53] ${action} 释放拖动捕获`);
    node.fire("onLostPointerCapture", { pointerId: 21 });
    c.bundle.window.dispatchEvent({ type: "pointerup", pointerId: 21 });
    await settle();
    eq(c.host.selects.length, action === "reset" ? 1 : 0, `[53] ${action} 后的捕获丢失不额外提交被取消的 max`);
    if (action === "reset") ok(!Object.hasOwn(c.host.selects[0], "reasoningEffort"), "[53] reset 仍由宿主解析默认档位");
    if (action !== "unmount") c.react.unmount();
  }
}

console.log(`\n${failed === 0 ? "全部通过 ✅" : "有失败 ❌"} （${passed} 项通过，${failed} 项失败）`);
if (failed > 0) {
  console.log("失败项：");
  for (const label of failures) console.log(`  · ${label}`);
  process.exitCode = 1;
}
