# MiraUI — 开发计划与架构设计

> 最后更新：2026-08-05
> 状态：历史规划文档（架构与目录示例反映初始方案；当前用法以 `README.md` 为准）

---

## 1. 项目概述

MiraUI 是一个基于 Electron 的 AI Agent UI 界面，对接 mira（基于 nanobot 框架开发）后端。
支持两种部署模式：

| 模式 | 说明 |
|------|------|
| **Desktop App** | Electron 打包的本地桌面应用，连接本地 mira |
| **Cloud Web App** | 纯 Web 应用（Nginx 托管），用户通过浏览器访问远程 mira |

UI 布局参考 [FARS](https://analemma.ai/fars)（Fully Automated Research System）。

---

## 2. 后端架构分析

### 2.1 mira 概况

| 项 | 值 |
|---|---|
| 源码位置 | `/Users/cwang/Code/mira/mira/` |
| 包名 | `mira 0.1`（pip editable install） |
| Conda 环境 | `nanobot` |
| CLI 入口 | `mira-engine` |
| 关键命令 | `mira gateway` / `mira agent -m "msg"` |

### 2.2 CLI 命令

```
mira
├── onboard     # 初始化配置和工作区
├── gateway     # 启动 gateway 服务（-p PORT, -w WORKSPACE, -c CONFIG）
├── agent       # 直接与 agent 交互（-m MESSAGE, -s SESSION_ID）
├── status      # 查看状态
├── channels    # 管理 channels (status / login)
└── provider    # 管理 providers
```

测试命令：
```bash
conda activate nanobot
mira agent -m "your message"
```

### 2.3 核心架构：异步消息总线

mira gateway **没有 HTTP API**。它是纯异步消息总线架构：

```
                        ┌─────────────────┐
                        │   AgentLoop     │
                        │  ┌───────────┐  │
  ┌──────────┐          │  │ LLM Call  │  │
  │ Telegram │──┐       │  │ Tool Exec │  │
  │ Discord  │  │  ┌────│  │ Memory    │  │
  │ WhatsApp │  ├─▶│ M  │  └───────────┘  │
  │ Slack    │  │  │ e  │                  │
  │ Feishu   │──┤  │ s  │  Tools:          │
  │ DingTalk │  │  │ s  │  - read/write    │
  │ Email    │  │  │ a  │  - exec          │
  │ QQ       │  │  │ g  │  - web_search    │
  │ Matrix   │──┤  │ e  │  - web_fetch     │
  │ Mochat   │  │  │    │  - message       │
  │ (CLI)    │──┘  │ B  │  - spawn         │
  │          │◀────│ u  │  - cron          │
  │          │     │ s  │  - MCP servers   │
  └──────────┘     └────│                  │
                        └─────────────────┘
```

**数据流**：

```
InboundMessage:   Channel → bus.publish_inbound() → AgentLoop 消费
OutboundMessage:  AgentLoop → bus.publish_outbound() → ChannelManager 分发 → Channel.send()
```

### 2.4 消息总线数据结构

源码：`mira/bus/events.py`

```python
@dataclass
class InboundMessage:
    channel: str            # "telegram", "discord", "web", ...
    sender_id: str          # 用户标识
    chat_id: str            # 聊天/频道标识
    content: str            # 消息文本
    timestamp: datetime     # 自动填充
    media: list[str]        # 媒体 URL 列表
    metadata: dict          # channel 特有的元数据
    session_key_override: str | None  # 线程级会话 key 覆盖

    @property
    def session_key(self) -> str:
        return self.session_key_override or f"{self.channel}:{self.chat_id}"

@dataclass
class OutboundMessage:
    channel: str
    chat_id: str
    content: str
    reply_to: str | None
    media: list[str]
    metadata: dict          # _progress=True 表示进度消息, _tool_hint=True 表示工具调用提示
```

### 2.5 BaseChannel 接口

源码：`mira/channels/base.py`

```python
class BaseChannel(ABC):
    name: str = "base"

    def __init__(self, config, bus: MessageBus): ...

    @abstractmethod
    async def start(self) -> None: ...      # 启动并持续监听

    @abstractmethod
    async def stop(self) -> None: ...       # 停止并清理

    @abstractmethod
    async def send(self, msg: OutboundMessage) -> None: ...  # 发送消息

    def is_allowed(self, sender_id: str) -> bool: ...  # 权限检查

    async def _handle_message(              # 接收消息 → 权限检查 → 发布到 bus
        self, sender_id, chat_id, content,
        media=None, metadata=None, session_key=None
    ) -> None: ...
```

### 2.6 会话管理

源码：`mira/session/manager.py`

- 会话按 `channel:chat_id` 分 key（如 `telegram:12345`, `cli:direct`）
- 存储为 JSONL 文件，位于 `{workspace}/sessions/`
- 第一行为 metadata（`_type: "metadata"`），后续为消息对象
- append-only 写入（利于 LLM 缓存）
- `memory_window` 默认 100 条未合并消息
- 超限时自动合并为 `MEMORY.md`（长期记忆）+ `HISTORY.md`（可检索日志）

### 2.7 Agent Loop

源码：`mira/agent/loop.py`

处理流程：
1. 从 bus 消费 `InboundMessage`
2. 加载/创建 session
3. 构建上下文：system prompt + memory + skills + 对话历史 + 当前消息
4. 调用 LLM（支持 model routing: small/medium/large）
5. 循环执行 tool calls（最多 `max_tool_iterations`=40 次）
6. 发布 `OutboundMessage` 回 bus

斜杠命令：`/new`（新会话）、`/stop`（取消任务）、`/help`

### 2.8 配置系统

源码：`mira/config/schema.py`

```python
class Config(BaseSettings):
    agents: AgentsConfig        # model, temperature, max_tokens, memory_window
    channels: ChannelsConfig    # 各 channel 配置
    providers: ProvidersConfig  # LLM provider API keys
    gateway: GatewayConfig      # host="0.0.0.0", port=18790 (当前未使用)
    tools: ToolsConfig          # web search, exec, mcp_servers
```

`GatewayConfig.port = 18790` 已定义但未被任何代码使用 — 这正好为 WebChannel 所用。

### 2.9 Channel Manager 注册流程

源码：`mira/channels/manager.py`

每个 channel 在 `_init_channels()` 中按以下模式注册：

```python
if self.config.channels.xxx.enabled:
    from mira.channels.xxx import XxxChannel
    self.channels["xxx"] = XxxChannel(self.config.channels.xxx, self.bus)
```

outbound 分发器 `_dispatch_outbound()` 持续从 bus 消费 `OutboundMessage`，按 `msg.channel` 路由到对应 channel。进度消息受 `send_progress` 和 `send_tool_hints` 配置控制。

---

## 3. 集成方案：WebChannel

### 3.1 方案选择

| 方案 | 描述 | 评估 |
|------|------|------|
| A. 新增 WebChannel | 在 mira 中新增 `channels/web.py`，遵循 BaseChannel 接口 | **最佳** — 架构最干净 |
| B. 外部 API Bridge | 独立 FastAPI 进程，通过某种 IPC 连接 bus | 复杂度高，需跨进程通信 |
| C. CLI 子进程 | Electron 通过 spawn 调用 `mira agent` | 仅适用 Desktop，无法 Cloud 部署 |

**选择方案 A**：创建 WebChannel，完美融入现有架构。

### 3.2 架构图

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│   MiraUI Frontend   │         │   mira gateway       │
│                         │  WS     │                              │
│   React + TypeScript    │◀═══════▶│   WebChannel (:18790)        │
│                         │  REST   │     │                        │
│   Electron / Browser    │◀───────▶│     ▼                        │
│                         │         │   MessageBus                 │
└─────────────────────────┘         │     │                        │
                                    │     ▼                        │
                                    │   AgentLoop → LLM            │
                                    │     │                        │
                                    │     ▼                        │
                                    │   Tools (exec, search, ...)  │
                                    └──────────────────────────────┘
```

### 3.3 WebChannel 详细设计

#### 文件改动清单

```
mira/mira/
├── channels/web.py          # 新增 — WebChannel 实现
├── config/schema.py         # 修改 — 新增 WebChannelConfig
└── channels/manager.py      # 修改 — 注册 web channel
```

#### WebChannelConfig

```python
class WebChannelConfig(Base):
    enabled: bool = False
    host: str = "0.0.0.0"
    port: int = 18790
    allow_from: list[str] = Field(default_factory=lambda: ["*"])
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

# 添加到 ChannelsConfig:
class ChannelsConfig(Base):
    ...
    web: WebChannelConfig = Field(default_factory=WebChannelConfig)
```

#### WebChannel 核心实现

```python
class WebChannel(BaseChannel):
    name = "web"

    async def start(self):
        app = web.Application(middlewares=[self._cors_middleware])
        app.router.add_get("/ws", self._ws_handler)
        app.router.add_get("/api/status", self._status_handler)
        app.router.add_get("/api/sessions", self._sessions_handler)
        app.router.add_get("/api/sessions/{session_id}/history", self._history_handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, self.config.host, self.config.port)
        await site.start()
        self._running = True

    async def _ws_handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self._clients[session_id] = ws
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
                await self._handle_message(
                    sender_id=data.get("user_id", "web_user"),
                    chat_id=data.get("session_id", "web:default"),
                    content=data["content"],
                    media=data.get("media", []),
                )
        del self._clients[session_id]

    async def send(self, msg: OutboundMessage):
        ws = self._clients.get(msg.chat_id)
        if ws and not ws.closed:
            await ws.send_json({
                "type": "progress" if msg.metadata.get("_progress") else "response",
                "content": msg.content,
                "media": msg.media,
                "metadata": msg.metadata,
            })

    async def stop(self):
        for ws in self._clients.values():
            await ws.close()
        self._clients.clear()
        self._running = False
```

### 3.4 WebSocket 协议

#### 前端 → 后端

```json
{
  "type": "message",
  "content": "分析这张胸片",
  "session_id": "web:user123",
  "user_id": "user123",
  "media": []
}
```

```json
{
  "type": "command",
  "command": "/new"
}
```

#### 后端 → 前端

```json
{
  "type": "progress",
  "content": "正在分析影像...",
  "metadata": { "_progress": true, "_tool_hint": false }
}
```

```json
{
  "type": "response",
  "content": "分析完成。该胸片显示...",
  "media": [],
  "metadata": {}
}
```

```json
{
  "type": "tool_call",
  "content": "web_search(\"chest x-ray findings\")",
  "metadata": { "_tool_hint": true }
}
```

#### REST 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | gateway 运行状态、已连接 channel 列表 |
| `/api/sessions` | GET | 所有 web session 列表 |
| `/api/sessions/:id/history` | GET | 指定 session 的对话历史 |
| `/api/sessions/:id/command` | POST | 发送斜杠命令 (/new, /stop) |

---

## 4. 技术栈

| 层级 | 技术 | 理由 |
|------|------|------|
| **Frontend** | React 18 + TypeScript | 生态成熟，组件化 |
| **构建工具** | Vite | 快 HMR，支持 Electron + Web 双构建 |
| **Desktop 壳** | Electron (electron-vite) | 跨平台桌面应用 |
| **UI 组件** | Tailwind CSS v4 + shadcn/ui | 深色主题友好，高度可定制 |
| **状态管理** | Zustand | 轻量，中等复杂度适用 |
| **实时通信** | WebSocket | 双向实时，连接 WebChannel |
| **后端新增** | aiohttp (WebChannel) | 嵌入 mira gateway，无额外进程 |
| **云端部署** | Docker + Nginx | 容器化前后端 |

---

## 5. UI 布局

### 5.1 总体布局

```
┌──────────────────────────────────────────────────────────────────────┐
│       [Project Title]                                  T+ HH:MM:SS │  Top Bar
├──────────────────────────────────────────────────────────────────────┤
│  ○──────────○──────────◉──────────○                                 │  Pipeline
│  Ideation     Planning    Experiment    Writing                     │  Progress
├────────┬─────────────────────────────┬───────────────────────────────┤
│        │                             │                               │
│ Queue  │   Task Detail               │   Agent Log                   │
│ Panel  │                             │                               │
│        │  1. Step A      [Completed] │   ┌─ Job Monitor ──────────┐ │
│ FA0008 │  2. Step B      [Running]   │   │ dlc5mf37te3ly2uf       │ │
│ FA0030 │     ● Phase 1  ✓           │   └────────────────────────┘ │
│[FA0039]│     ○ Phase 2              │                               │
│ FA0031 │     ○ Phase 3              │   21:31                       │
│ FA0004 │  3. Step C                  │   GPU memory at ~82%...      │
│ FA0011 │  4. Step D                  │                               │
│ FA0025 │                             │   22:08                       │
│ FA0036 │                             │   Step 1 completed in 50m... │
│ FA0013 │                             │                               │
│        │                             │   ▽ Worked for <1s           │
│────────│                             │     🔧 Train Service get     │
│● Manual│                             │                         [💬] │
│  Auto  │                             │                               │
├────────┴─────────────────────────────┴───────────────────────────────┤
│  50           9         Launched Hyp×10 Paper×1      1.67B    13K  │  Status
│ Hypothesis   Paper                                   Tokens   Cost │  Bar
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 组件拆解

| 区域 | 组件 | 功能描述 |
|------|------|----------|
| **Top Bar** | `<TopBar>` | 项目标题（居中），运行计时器 T+ HH:MM:SS（右侧） |
| **Pipeline** | `<PipelineProgress>` | 4 阶段水平进度条：Ideation → Planning → Experiment → Writing，圆点节点 + 连线，当前阶段高亮放大 |
| **Left** | `<ProjectQueue>` | In Progress / Completed Tab 切换；任务卡片列表（ID 编号）；选中高亮；底部 Manual/Auto 模式开关 |
| **Center** | `<TaskDetail>` | 编号步骤列表；每步有状态标签（Completed 绿 / Running 蓝）；子阶段缩进，●/○ 状态指示器；支持折叠 |
| **Right** | `<AgentLog>` | Job Monitor 卡片（顶部）；带时间戳的日志条目；可折叠 "Worked for" 段落；自动滚动到最新 |
| **Bottom** | `<StatusBar>` | 左侧：大数字 + 标签（Hypothesis / Paper）；中部：pipeline 阶段小标签；右侧：Tokens 数 / Cost ($) |
| **FAB** | `<ChatButton>` + `<ChatPanel>` | 右下浮动聊天按钮；点击展开对话面板（发消息到 Agent） |

### 5.3 配色方案（深色主题）

| 用途 | 色值 | 说明 |
|------|------|------|
| 页面背景 | `#0d1117` | 接近 GitHub Dark |
| 面板/卡片背景 | `#161b22` | 略亮一级 |
| 选中/悬停 | `#1f2937` | slate-800 |
| 主强调色 | `#3b82f6` | blue-500（当前阶段、Running 标签） |
| 成功色 | `#22c55e` | green-500（Completed、✓） |
| 文本主色 | `#e5e7eb` | gray-200 |
| 文本次色 | `#9ca3af` | gray-400（时间戳、次要信息） |
| 边框 | `#30363d` | 面板分隔线 |

---

## 6. 项目目录结构

```
MiraUI/
├── plan.md                          # 本文档
├── electron/                        # Electron 主进程
│   ├── main.ts                      # Electron 入口，创建 BrowserWindow
│   ├── preload.ts                   # contextBridge 安全暴露 API
│   └── ipc/                         # IPC 通信处理器
├── src/                             # React 前端（渲染进程 / Web）
│   ├── main.tsx                     # React 入口
│   ├── App.tsx                      # 根组件 + 路由
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx        # 三栏布局 (CSS Grid)
│   │   │   ├── TopBar.tsx           # 标题 + 计时器
│   │   │   └── StatusBar.tsx        # 底部统计栏
│   │   ├── pipeline/
│   │   │   └── PipelineProgress.tsx # 阶段进度条
│   │   ├── queue/
│   │   │   ├── ProjectQueue.tsx     # 任务队列面板
│   │   │   └── QueueItem.tsx        # 单个任务卡片
│   │   ├── task/
│   │   │   ├── TaskDetail.tsx       # 步骤详情面板
│   │   │   ├── StepItem.tsx         # 单个步骤
│   │   │   └── PhaseItem.tsx        # 子阶段条目
│   │   ├── agent/
│   │   │   ├── AgentLog.tsx         # 日志面板
│   │   │   ├── LogEntry.tsx         # 单条日志
│   │   │   └── JobMonitor.tsx       # Job Monitor 卡片
│   │   └── chat/
│   │       ├── ChatButton.tsx       # 浮动按钮
│   │       └── ChatPanel.tsx        # 对话面板
│   ├── hooks/
│   │   ├── useWebSocket.ts          # WebSocket 连接管理 + 重连
│   │   ├── useAgentStream.ts        # Agent 消息流解析
│   │   └── useTimer.ts              # T+ 计时器
│   ├── stores/
│   │   ├── projectStore.ts          # 项目/任务队列状态
│   │   ├── agentStore.ts            # Agent 日志/对话状态
│   │   └── uiStore.ts               # UI 状态（面板展开等）
│   ├── services/
│   │   ├── api.ts                   # REST 请求封装
│   │   └── websocket.ts            # WebSocket 客户端封装
│   ├── types/
│   │   └── index.ts                 # TypeScript 类型定义
│   └── styles/
│       └── globals.css              # Tailwind + 全局样式
├── docker/
│   ├── Dockerfile.frontend          # Web 前端镜像
│   └── docker-compose.yml           # 前端 + mira 编排
├── electron-builder.yml             # Electron 打包配置
├── vite.config.ts                   # Vite 配置 (Web 模式)
├── electron.vite.config.ts          # electron-vite 配置
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 7. 双模式部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                     React Frontend                           │
│              (同一套代码，同一套 React 组件)                    │
└────────────┬────────────────────────────┬────────────────────┘
             │                            │
   ┌─────────▼─────────┐       ┌──────────▼──────────┐
   │  Electron Shell    │       │   Nginx / CDN       │
   │  (Desktop App)     │       │   (Cloud Web App)   │
   └─────────┬──────────┘       └──────────┬──────────┘
             │                             │
             └──────────┬──────────────────┘
                        │
               WebSocket ws(s)://host:18790/ws
               REST      http(s)://host:18790/api/*
                        │
             ┌──────────▼──────────────────┐
             │  mira gateway       │
             │                             │
             │  ┌─ WebChannel (:18790) ──┐ │
             │  │  WS server + REST API  │ │
             │  └────────┬───────────────┘ │
             │           │                 │
             │  ┌────────▼──────────────┐  │
             │  │     MessageBus        │  │
             │  │  inbound / outbound   │  │
             │  └────────┬──────────────┘  │
             │           │                 │
             │  ┌────────▼──────────────┐  │
             │  │     AgentLoop         │  │
             │  │  LLM + Tools + Memory │  │
             │  └───────────────────────┘  │
             │                             │
             │  Other channels:            │
             │  Telegram, Discord, ...     │
             └─────────────────────────────┘
```

**环境变量切换**：

```typescript
// src/services/platform.ts
const isElectron = typeof window !== 'undefined'
  && typeof window.process === 'object';

const WS_URL  = import.meta.env.VITE_WS_URL  ?? 'ws://localhost:18790/ws';
const API_URL = import.meta.env.VITE_API_URL  ?? 'http://localhost:18790/api';
```

| 模式 | VITE_WS_URL | VITE_API_URL |
|------|-------------|-------------|
| Desktop 开发 | `ws://localhost:18790/ws` | `http://localhost:18790/api` |
| Cloud 生产 | `wss://your-server.com/ws` | `https://your-server.com/api` |

Cloud 模式下 Nginx 反向代理到 mira gateway :18790。

---

## 8. 开发阶段规划

### Phase 0：后端 WebChannel（Week 1）

> **目标**：让 mira gateway 暴露 WebSocket + REST API

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 `WebChannelConfig` | `config/schema.py` | enabled, host, port, allow_from, cors_origins |
| 添加到 `ChannelsConfig` | `config/schema.py` | `web: WebChannelConfig` |
| 实现 `WebChannel` | `channels/web.py` | 继承 BaseChannel，aiohttp 驱动 |
| 注册 channel | `channels/manager.py` | `_init_channels()` 中添加 web |
| WebSocket 端点 | `channels/web.py` | `/ws` — 双向消息 |
| REST 端点 | `channels/web.py` | `/api/status`, `/api/sessions`, `/api/sessions/:id/history` |
| 测试验证 | — | websocat + 简易 HTML 页面 |

**验收标准**：
```bash
# 终端 1：启动 gateway
mira gateway

# 终端 2：WebSocket 测试
websocat ws://localhost:18790/ws
> {"type":"message","content":"hello","session_id":"web:test"}
< {"type":"response","content":"...agent reply..."}
```

### Phase 1：前端项目初始化（Week 1-2）

| 任务 | 说明 |
|------|------|
| `npm create electron-vite` | 脚手架初始化 |
| Tailwind CSS v4 + shadcn/ui | 深色主题配置 |
| `<AppLayout>` | CSS Grid 三栏布局 (160px / 1fr / 1fr) |
| 双构建验证 | `npm run dev` (Web) + `npm run electron:dev` (Desktop) |
| 环境变量 | `.env.development` / `.env.production` |

### Phase 2：静态 UI 搭建（Week 2-3）

使用 Mock 数据搭建全部组件：

| 组件 | 关键实现点 |
|------|-----------|
| `<TopBar>` | 标题居中 flex, 计时器右对齐 |
| `<PipelineProgress>` | SVG/CSS 绘制节点 + 连线, 当前阶段高亮 |
| `<ProjectQueue>` | Tab 切换, 列表虚拟化（如超过50项）, 选中态 |
| `<TaskDetail>` | 递归树形结构, 折叠展开动画, 状态 badge |
| `<AgentLog>` | 虚拟滚动, 时间戳分组, Markdown 渲染 |
| `<StatusBar>` | 大数字 + 小标签 flex 布局 |
| `<ChatPanel>` | 消息输入框 + 消息列表 |

### Phase 3：WebSocket 集成与实时数据（Week 3-4）

| 任务 | 说明 |
|------|------|
| `useWebSocket` | 连接管理, 指数退避重连 (1s→2s→4s→...→30s), 心跳 ping/pong |
| `useAgentStream` | 消息类型分发: response → agentStore, progress → 流式更新, tool_call → 工具提示 |
| Zustand stores | projectStore（队列）, agentStore（日志）, uiStore（面板状态） |
| `<AgentLog>` 绑定 | 实时 WebSocket → store → 组件 |
| `<ChatPanel>` 发送 | 输入 → WebSocket send → 等待回复 |
| `useTimer` | 后端返回 start_time, 前端 setInterval 计算 elapsed |

### Phase 4：数据绑定与交互完善（Week 4-5）

| 任务 | 说明 |
|------|------|
| 会话历史 | REST 加载 `/api/sessions/:id/history` → 初始化对话 |
| 队列 ↔ 详情联动 | 点击左侧项 → 中间面板切换 → 右侧日志切换 |
| Manual/Auto | 模式切换 + 对应行为 |
| 折叠动画 | framer-motion 或 CSS transition |
| Pipeline 推进 | 后端状态 → 前端自动更新当前阶段 |
| 响应式 | 侧边栏可收起, 窗口小于阈值自动折叠 |

### Phase 5：打包与部署（Week 5-6）

| 任务 | 说明 |
|------|------|
| Electron 打包 | macOS: DMG/universal, Windows: NSIS, Linux: AppImage |
| 自动更新 | electron-updater + GitHub Releases |
| Docker 镜像 | Dockerfile.frontend (Nginx + 静态) |
| docker-compose | frontend (:80) + mira gateway (:18790) |
| Nginx 配置 | 静态资源 + WebSocket 反代 (proxy_pass + Upgrade header) |
| CI/CD | GitHub Actions: lint → test → build → publish |

### Phase 6：打磨与测试（Week 6-7）

| 任务 | 说明 |
|------|------|
| 安全加固 | nodeIntegration: false, contextBridge, CSP header |
| E2E 测试 | Playwright (Web + Electron) |
| 性能优化 | 代码分割, React.lazy, 日志虚拟滚动, 长列表截断 |
| 断线恢复 | 重连后拉取未收到的消息 |
| 认证 | Cloud 模式: JWT token 中间件 |

---

## 9. 快速启动命令（预期）

```bash
# ===== 后端 =====
conda activate nanobot
mira gateway                     # 启动 gateway + WebChannel :18790
mira agent -m "hello"            # CLI 直接测试 agent

# ===== 前端开发 =====
cd ~/Shared/MiraUI
npm install
npm run dev                              # Web 模式 → http://localhost:5173
npm run electron:dev                     # Desktop 模式

# ===== 构建 =====
npm run build:web                        # → dist/  (静态资源)
npm run build:electron                   # → release/ (安装包)

# ===== Docker 部署 =====
cd docker
docker-compose up -d                     # 前端 :80 + 后端 :18790
```

---

## 10. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| 1 | WebChannel 与现有 bus 集成出问题 | 后端无法响应 | 严格遵循 BaseChannel 接口，写集成测试 |
| 2 | WebSocket 连接不稳定 (Cloud) | 消息丢失 | 指数退避重连 + 心跳 + 断线消息缓冲 |
| 3 | Agent 大量日志导致前端卡顿 | UX 差 | 虚拟滚动 + 条数上限 + 分页加载历史 |
| 4 | Electron 安全漏洞 | 安全风险 | 禁用 nodeIntegration, contextBridge, CSP |
| 5 | Cloud 无认证 | 未授权访问 | Phase 6 添加 JWT 认证 |
| 6 | 跨平台打包兼容性 | 特定平台失败 | CI 矩阵 macOS/Windows/Linux 分别测试 |
| 7 | nanobot 框架升级引入 breaking changes | 后端不兼容 | 锁定版本，WebChannel 做适配层 |

---

## 11. 开发日志

> 在此记录每个阶段的实际进展、决策变更、遇到的问题。

### 2026-03-22 — 项目规划

- 完成 mira 后端架构分析
- 确认 gateway 无 HTTP API，需新增 WebChannel
- 确定技术栈与 7 阶段开发计划
- 创建本文档
