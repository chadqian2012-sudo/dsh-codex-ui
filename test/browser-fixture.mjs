import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TEST_DIR);
const ASAR_PATH = process.env.DSH_APP_ASAR ?? 'D:/Harness_Desktop/resources/app.asar';
const DEPS = path.resolve(ROOT, '.work/browser-deps/node_modules');
const RUNTIME_DEPS = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function asarIndex(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const prelude = Buffer.alloc(16);
    fs.readSync(fd, prelude, 0, prelude.length, 0);
    const jsonLength = prelude.readUInt32LE(12);
    if (jsonLength <= 0 || jsonLength > 32 * 1024 * 1024) throw new Error('Unexpected ASAR header size');
    const header = Buffer.alloc(jsonLength);
    fs.readSync(fd, header, 0, header.length, 16);
    return { fd, headerDataStart: 8 + prelude.readUInt32LE(4), files: JSON.parse(header.toString('utf8')) };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function entryAt(files, entryPath) {
  return entryPath.split('/').reduce((node, key) => node?.files?.[key], files);
}

export function readAsarEntry(entryPath, asarPath = ASAR_PATH) {
  const index = asarIndex(asarPath);
  try {
    const entry = entryAt(index.files, entryPath);
    if (!entry || entry.files || entry.unpacked) throw new Error(`ASAR entry unavailable: ${entryPath}`);
    const data = Buffer.alloc(entry.size);
    const position = index.headerDataStart + Number(entry.offset);
    fs.readSync(index.fd, data, 0, data.length, position);
    return data;
  } finally {
    fs.closeSync(index.fd);
  }
}

export const OFFICIAL_CLIENT_PATH = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js';
export const OFFICIAL_PACKAGE_PATH = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/package.json';

export function readOfficialCss(asarPath = ASAR_PATH) {
  const source = readAsarEntry(OFFICIAL_CLIENT_PATH, asarPath).toString('utf8');
  const literal = source.match(/const css = ("(?:\\.|[^"\\])*");/);
  if (!literal) throw new Error('Could not locate official ModelSelect CSS in the installed package');
  return JSON.parse(literal[1]);
}

export function resolveBrowser() {
  if (process.env.BROWSER_EXECUTABLE && fs.existsSync(process.env.BROWSER_EXECUTABLE)) return process.env.BROWSER_EXECUTABLE;
  if (fs.existsSync(CHROME)) return CHROME;
  if (fs.existsSync(EDGE)) return EDGE;
  throw new Error('Set BROWSER_EXECUTABLE to an installed Chromium based browser');
}

export function resolveDependency(name, file) {
  for (const base of [path.join(ROOT, 'node_modules'), DEPS, RUNTIME_DEPS]) {
    const candidate = path.join(base, name, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing browser test dependency: ${name}/${file}`);
}

export async function startBrowserFixture() {
  const react = fs.readFileSync(resolveDependency('react', 'umd/react.development.js'));
  const reactDom = fs.readFileSync(resolveDependency('react-dom', 'umd/react-dom.development.js'));
  const plugin = fs.readFileSync(path.join(ROOT, 'lib/client.js'));
  const nativeCss = Buffer.from(readOfficialCss());
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/fixture') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/native.css"><style>html,body{margin:0;min-height:100%;font:16px Arial,sans-serif}body{padding:36px;background:#f4f5f7;color:#202124}body[data-theme=dark]{background:#17181b;color:#eee}.fixture{width:min(420px,calc(100vw - 48px));padding:24px;background:#fff;border-radius:18px}body[data-theme=dark] .fixture{background:#242529}.label{margin-bottom:12px}</style></head><body><div class="fixture"><div class="label">Model selection fixture</div><div id="app"></div></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/fixture-ui.js"></script><script src="/plugin.js"></script><script>window.__fixtureReady=true</script></body></html>`);
      return;
    }
    const payloads = { '/react.js': react, '/react-dom.js': reactDom, '/fixture-ui.js': Buffer.from(fixtureUi), '/plugin.js': plugin, '/native.css': nativeCss };
    const body = payloads[url.pathname];
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': url.pathname === '/native.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/`, executablePath: resolveBrowser() };
}

export const fixtureUi = String.raw`
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  const h = React.createElement;
  const state = window.__fixture = { opens: 0, messages: 0, selections: [], current: {provider:'deepseek', model:'deepseek-chat'}, effort:'high', pending:null, generation:0, pane:'root', reports:[] };
  const listeners = new Set();
  const levels=[{id:'off',name:'Off'},{id:'low',name:'Low'},{id:'high',name:'High'},{id:'max',name:'Max'}];
  function makeSnapshot(){ return { current:{...state.current,reasoningEffort:state.effort}, value:{...state.current, reasoningEffort:state.effort}, status:state.pending?'selecting':'ready', pending:state.pending&&{...state.pending}, error:null, groups:[{id:'deepseek',name:'DeepSeek',models:[{id:'deepseek-chat',name:'DeepSeek Chat',reasoning:{efforts:levels,defaultEffort:'high'}},{id:'deepseek-reasoner',name:'DeepSeek Reasoner',reasoning:{efforts:levels,defaultEffort:'high'}}]}] }; }
  let cachedSnapshot=makeSnapshot();
  const snapshot = () => cachedSnapshot;
  const publish = () => { cachedSnapshot=makeSnapshot(); for(const fn of listeners)fn(); };
  const directory = {
    store:{ getSnapshot:snapshot, subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);} },
    load(){},
    select(selection){ state.selections.push({...selection}); const generation=++state.generation; state.pending={...selection}; publish(); return new Promise((resolve)=>setTimeout(()=>{ if(generation!==state.generation)return resolve(); state.current={provider:selection.provider,model:selection.model}; if(selection.reasoningEffort!==undefined)state.effort=selection.reasoningEffort; else state.effort='high'; state.pending=null; publish(); resolve(snapshot().value); },90)); }
  };
  const modelName=(id)=>id==='deepseek-chat'?'DeepSeek-V4.1-Flash':id==='deepseek-reasoner'?'DeepSeek-R1':id;
  const menuId='official-model-menu';
  function OfficialModelSelect(){
    const [open,setOpen]=React.useState(false),[pane,setPane]=React.useState('root');
    const [menuPos,setMenuPos]=React.useState(null), triggerRef=React.useRef(null), menuRef=React.useRef(null);
    state.pane=pane;
    const label=(text)=>h('span',null,text);
    React.useLayoutEffect(()=>{
      if(!open)return;
      const place=()=>{const el=menuRef.current,trigger=triggerRef.current;if(!el||!trigger)return;const rect=trigger.getBoundingClientRect(),margin=12,gap=8,width=el.offsetWidth,height=el.offsetHeight;const left=Math.min(Math.max(margin,rect.left),Math.max(margin,window.innerWidth-width-margin));const top=Math.min(Math.max(margin,rect.bottom+gap),Math.max(margin,window.innerHeight-height-margin));setMenuPos({position:'fixed',left,top});};
      place();
      const observer=typeof ResizeObserver==='function'&&menuRef.current?new ResizeObserver(place):null;
      if(observer&&menuRef.current)observer.observe(menuRef.current);
      window.addEventListener('resize',place);
      return()=>{observer&&observer.disconnect();window.removeEventListener('resize',place);};
    },[open,pane]);
    const menu=open ? h('div',{ref:menuRef,id:menuId,className:'wq12jW_menu',role:pane==='model'?'group':'menu','aria-label':'Select model',style:menuPos??{position:'fixed',left:12,top:12}},pane==='root' ? [
      h('button',{key:'models',type:'button',role:'menuitem',className:'wq12jW_cell',onClick:()=>setPane('model')},h('span',{className:'wq12jW_cellLabel'},'模型'),h('span',{className:'wq12jW_cellValue'},modelName(state.current.model)),h('svg',{className:'wq12jW_cellChevron',width:12,height:12},h('path',{d:'M4 2l4 4-4 4',fill:'none',stroke:'currentColor'}))),
      h('button',{key:'effort',type:'button',role:'menuitem',className:'wq12jW_cell',onClick:()=>{}},h('span',{className:'wq12jW_cellLabel'},'推理等级'),h('span',{className:'wq12jW_cellValue'},state.effort),h('svg',{className:'wq12jW_cellChevron',width:12,height:12},h('path',{d:'M4 2l4 4-4 4',fill:'none',stroke:'currentColor'})))
    ] : [
      h('div',{key:'models',id:'official-model-models',className:'wq12jW_groups scrollable',role:'menu','aria-label':'Models'},
        h('div',{className:'wq12jW_group'}, h('div',{role:'heading',className:'wq12jW_groupLabel'},'DeepSeek'), ...['deepseek-chat','deepseek-reasoner'].map((model)=>
          h('button',{key:model,type:'button',role:'menuitemradio',className:'wq12jW_option wq12jW_modelOption','aria-checked':String(state.current.model===model),disabled:state.pending!==null,onClick:()=>{directory.select({provider:'deepseek',model});setOpen(false);setPane('root');}},
            h('span',{className:'wq12jW_optionCopy'},h('span',{className:'wq12jW_modelName','data-provider-id':'deepseek','data-model-id':model},modelName(model))),
            h('span',{className:'wq12jW_check'},state.current.model===model?h('svg',{viewBox:'0 0 24 24',width:20,height:20,'aria-hidden':true},h('path',{d:'m5 12 4 4L19 6',fill:'none',stroke:'currentColor',strokeWidth:1.8})):null)))))
    ]) : null;
    return h('div',{className:'wq12jW_root',onKeyDown:(event)=>{if(event.key==='Escape'&&open){event.preventDefault();if(pane!=='root')setPane('root');else setOpen(false);triggerRef.current?.focus();}}},h('button',{ref:triggerRef,type:'button','aria-label':'Select model','aria-haspopup':'menu','aria-expanded':String(open),'aria-controls':open?menuId:undefined,onClick:()=>{state.opens++;setOpen(!open);setPane('root')}},'DeepSeek'),menu && ReactDOM.createPortal(menu,document.body));
  }
  function App(){return h('div',{ 'data-composer-card':'' },h(OfficialModelSelect),h('div',{id:'slot-mount'}));}
  window.__fixtureRender=()=>ReactDOM.render(h(App),document.getElementById('app'));
  window.__ModuleLoader__={load(registration){window.__registration=registration;}};
  window.__fixtureRender();
  state.directoryLookups=[];
  const ctx={ slots:{ inject(_name,setup){setup();}, register(entry,SlotComponent){setTimeout(()=>ReactDOM.render(h(SlotComponent,{sessionId:new URL(location.href).searchParams.get('session')||'session-1'}),document.getElementById('slot-mount')),0);return()=>{};} }, modelDirectories:{directoryFor(sessionId){state.directoryLookups.push(sessionId);return sessionId.startsWith('session-')?directory:null;}}, sessions:{}, remote:{}, console };
  window.__loadPlugin=()=>{window.__plugin=window.__registration.factory((name)=>name==='react'?React:name==='react-dom'?ReactDOM:(()=>{throw Error('Unexpected require '+name)})());return window.__plugin;};
  window.__applyPlugin=()=>window.__loadPlugin().apply(ctx);
  window.__directory=directory;
`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await startBrowserFixture();
  console.log(`Browser fixture: ${fixture.url}`);
  console.log('Press Ctrl+C to stop the local fixture server.');
  const shutdown = () => fixture.server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
