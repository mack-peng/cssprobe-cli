# Code Design: Session Mode

## Overview

cssprobe-cli 将复用 playwright-cli 的 daemon + session 架构，提供非阻塞的浏览器管理和 CSS 诊断能力。

## Architecture

```
cssprobe-cli
├── src/
│   ├── cli/
│   │   ├── program.ts          # CLI 入口
│   │   ├── commands.ts         # 命令定义（合并 playwright-cli + cssprobe 命令）
│   │   ├── command.ts          # 命令解析
│   │   ├── output.ts           # 输出格式化
│   │   └── minimist.ts         # 参数解析（已有）
│   ├── daemon/
│   │   ├── daemon.ts           # Daemon 进程（复制自 playwright-cli）
│   │   ├── session.ts          # Session 管理（简化版，单 session）
│   │   └── registry.ts         # Session 注册表（简化版）
│   ├── backend/
│   │   ├── browserBackend.ts   # 浏览器后端（复制自 playwright-cli）
│   │   ├── context.ts          # 浏览器上下文（复制自 playwright-cli）
│   │   ├── tool.ts             # Tool 接口（复制自 playwright-cli）
│   │   ├── tools.ts            # Tool 注册（合并 playwright + cssprobe tools）
│   │   ├── response.ts         # 响应处理（复制自 playwright-cli）
│   │   └── tools/
│   │       ├── evaluate.ts     # JS 执行（复制自 playwright-cli）
│   │       ├── screenshot.ts   # 截图（复制自 playwright-cli）
│   │       ├── pdf.ts          # PDF（复制自 playwright-cli）
│   │       ├── navigate.ts     # 导航（复制自 playwright-cli）
│   │       ├── tabs.ts         # Tab 管理（复制自 playwright-cli）
│   │       ├── cssprobe.ts     # CSSprobe 工具（新增）
│   │       │   ├── inspect.ts  # CSS 诊断
│   │       │   ├── tree.ts     # DOM 树
│   │       │   ├── layout.ts   # 布局图
│   │       │   ├── findings.ts # 问题发现
│   │       │   ├── snapshot.ts # 快照
│   │       │   └── injectCss.ts# CSS 注入
│   │       └── index.ts        # 工具导出
│   ├── browser/
│   │   └── launcher.ts         # 浏览器启动（保留，用于 daemon 启动）
│   ├── engine/
│   │   ├── collector.ts        # 数据收集（保留）
│   │   ├── analyzer.ts         # 分析（保留）
│   │   └── renderer.ts         # 渲染（保留）
│   └── utils/
│       └── socketConnection.ts # Socket 通信（复制自 playwright-cli）
```

## Key Components

### 1. Session Management

**简化版单 Session 实现：**

```typescript
// src/daemon/session.ts
export class Session {
  readonly name: string = 'default';
  private _sessionFile: SessionFile;

  async run(args: MinimistArgs): Promise<{ text: string }> {
    const { socket } = await this._connect();
    return await SocketConnectionClient.sendAndClose(socket, 'run', { args, cwd: process.cwd() });
  }

  async stop(): Promise<void> {
    const { socket } = await this._connect();
    await SocketConnectionClient.sendAndClose(socket, 'stop', {});
  }

  private async _connect(): Promise<{ socket?: net.Socket }> {
    const sessionConfig = await this._loadSessionConfig();
    if (!sessionConfig) return {};
    return { socket: net.createConnection(sessionConfig.socketPath) };
  }
}
```

**Session 文件位置：**
- macOS: `~/Library/Caches/ms-playwright/daemon/<workspaceHash>/default.session`
- Linux: `~/.cache/ms-playwright/daemon/<workspaceHash>/default.session`

### 2. Daemon Process

**Daemon 启动流程：**
1. `cssprobe-cli open <url>` 调用 `Session.startDaemon()`
2. Daemon 进程启动，监听 Unix socket
3. 接收命令，通过 BrowserBackend 执行
4. 返回结果给客户端

**Daemon 入口：**
```typescript
// src/daemon/daemonEntry.ts
import { startCliDaemonServer } from './daemon';
import { BrowserBackend } from '../backend/browserBackend';
import { browserTools } from '../backend/tools';

export async function runDaemon(sessionName: string, args: string[]) {
  // 1. 启动浏览器
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  
  // 2. 创建 BrowserBackend
  const backend = new BrowserBackend(config, context, browserTools);
  
  // 3. 启动 daemon server
  await startCliDaemonServer(sessionName, context, browserInfo, config, clientInfo, mcpClientInfo, options);
}
```

### 3. Backend Tools

**现有 playwright-cli 工具（需要复制）：**
- `evaluate.ts` - JS 执行
- `screenshot.ts` - 截图
- `pdf.ts` - PDF 生成
- `navigate.ts` - 页面导航
- `tabs.ts` - Tab 管理

**新增 cssprobe 工具：**

```typescript
// src/backend/tools/cssprobe/inspect.ts
import { defineTabTool } from '../tool';
import { collect } from '../../../engine/collector';
import { analyze } from '../../../engine/analyzer';
import { renderMarkdown, renderJSON } from '../../../engine/renderer';

const inspectTool = defineTabTool({
  capability: 'core',
  schema: {
    name: 'cssprobe_inspect',
    title: 'CSS Inspection',
    description: 'Inspect runtime CSS of a page element',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector for the root element'),
      depth: z.number().optional().describe('DOM tree depth'),
      json: z.boolean().optional().describe('Output as JSON'),
      brief: z.boolean().optional().describe('Compact output'),
      layout: z.boolean().optional().describe('ASCII layout diagram'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const snapshot = await collect(tab.page, {
      rootSelector: params.selector,
      downDepth: params.depth || 6,
      maxNodes: 60,
    });
    
    const findings = analyze(snapshot);
    
    if (params.json) {
      response.addResult('Inspection result', JSON.stringify(renderJSON(snapshot, findings, params.brief), null, 2));
    } else {
      response.addResult('Inspection result', renderMarkdown(snapshot, findings, params.brief, params.layout));
    }
  },
});
```

### 4. Command Definitions

**合并 playwright-cli 和 cssprobe 命令：**

```typescript
// src/cli/commands.ts
import * as z from 'zod';
import { declareCommand } from './command';

// 浏览器管理命令（复用 playwright-cli）
const open = declareCommand({
  name: 'open',
  category: 'core',
  description: 'Open the browser',
  args: z.object({
    url: z.string().optional().describe('URL to navigate to'),
  }),
  options: z.object({
    browser: z.string().optional().describe('Browser engine'),
    headed: z.boolean().optional().describe('Show browser window'),
  }),
});

const close = declareCommand({
  name: 'close',
  category: 'core',
  description: 'Close the browser',
});

// CSSprobe 增强命令（新增）
const inspect = declareCommand({
  name: 'inspect',
  category: 'cssprobe',
  description: 'Inspect runtime CSS of a page element',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
  options: z.object({
    json: z.boolean().optional().describe('Output as JSON'),
    brief: z.boolean().optional().describe('Compact output'),
    layout: z.boolean().optional().describe('ASCII layout diagram'),
    depth: z.number().optional().describe('DOM tree depth'),
  }),
});

const tree = declareCommand({
  name: 'tree',
  category: 'cssprobe',
  description: 'Show DOM tree structure',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
  options: z.object({
    depth: z.number().optional().describe('Tree depth'),
  }),
});

const layout = declareCommand({
  name: 'layout',
  category: 'cssprobe',
  description: 'Show ASCII layout diagram',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
});

const findings = declareCommand({
  name: 'findings',
  category: 'cssprobe',
  description: 'Show only issues/warnings',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
});

const injectCss = declareCommand({
  name: 'inject-css',
  category: 'cssprobe',
  description: 'Inject CSS into the current page',
  args: z.object({
    css: z.string().describe('CSS code to inject'),
  }),
});

// 导出所有命令
export const commands = {
  open,
  close,
  inspect,
  tree,
  layout,
  findings,
  'inject-css': injectCss,
  // ... 其他命令
};
```

### 5. Socket Communication

**复制自 playwright-cli，无需修改：**

```typescript
// src/utils/socketConnection.ts
export class SocketConnection {
  private _socket: net.Socket;
  private _pendingBuffers: Buffer[] = [];

  onclose?: () => void;
  onmessage?: (message: any) => void;

  constructor(socket: net.Socket) {
    this._socket = socket;
    socket.on('data', buffer => this._onData(buffer));
    socket.on('close', () => this.onclose?.());
  }

  async send(message: { id: number, error?: string, result?: any }) {
    await new Promise((resolve, reject) => {
      this._socket.write(`${JSON.stringify(message)}\n`, error => {
        if (error) reject(error);
        else resolve(undefined);
      });
    });
  }

  close() {
    this._socket.destroy();
  }
}
```

## Data Flow

### 1. 打开浏览器

```
用户执行: cssprobe-cli open https://example.com --headed
    ↓
CLI 程序解析参数
    ↓
Session.startDaemon() 启动 daemon 进程
    ↓
Daemon 进程启动，监听 Unix socket
    ↓
CLI 连接 daemon，发送 goto 命令
    ↓
Daemon 执行导航，返回结果
    ↓
CLI 输出: {"sessionId":"default","pid":12345,"url":"https://example.com"}
```

### 2. 执行 CSS 诊断

```
用户执行: cssprobe-cli inspect .sidebar --json
    ↓
CLI 程序解析参数
    ↓
Session.run() 连接 daemon socket
    ↓
发送命令: { method: 'run', args: { _: ['inspect', '.sidebar'], json: true } }
    ↓
Daemon 接收命令，调用 cssprobe_inspect tool
    ↓
Tool 注入 collector，执行分析
    ↓
返回 JSON 结果
    ↓
CLI 输出诊断结果
```

### 3. 注入 CSS

```
用户执行: cssprobe-cli inject-css ".sidebar { background: red; }"
    ↓
CLI 程序解析参数
    ↓
Session.run() 连接 daemon socket
    ↓
发送命令: { method: 'run', args: { _: ['inject-css', '.sidebar { background: red; }'] } }
    ↓
Daemon 接收命令，调用 cssprobe_inject_css tool
    ↓
Tool 执行 page.addStyleTag({ content: css })
    ↓
返回成功结果
    ↓
CLI 输出: {"success":true}
```

## Dependencies

| 依赖 | 版本 | 用途 |
|------|------|------|
| playwright-core | 已有 | 浏览器 API |
| zod | 已有 | 参数验证 |
| debug | 需要添加 | 日志 |

## Migration Plan

### Phase 1: 基础设施
1. 复制 socketConnection.ts
2. 复制 session.ts, registry.ts（简化版）
3. 复制 daemon.ts
4. 复制 backend 基础（browserBackend.ts, context.ts, tool.ts, response.ts）

### Phase 2: 工具集成
1. 复制 playwright-cli 工具（evaluate, screenshot, pdf, navigate, tabs）
2. 实现 cssprobe 工具（inspect, tree, layout, findings, inject-css）

### Phase 3: CLI 集成
1. 合并命令定义
2. 更新 CLI 入口
3. 更新输出格式

### Phase 4: 测试
1. 单元测试
2. 集成测试
3. 端到端测试

## Backward Compatibility

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `login <url>` | `open <url>` → 手动登录 → `save-state` | 流程变化 |
| `inspect <url> --wait` | `open <url>` → 手动操作 → `inspect <selector>` | 流程变化 |
| `interactive <url>` | `open <url>` → 多次 `inspect`/`tree`/`inject-css` | 流程变化 |
| `state-import` | 保留 | 不变 |
