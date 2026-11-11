# @local/dsh-runcode-mode

为 DeepSeek Harness (DSH) 增加一个 **「无提示词、只有 run_code」** 的 Agent 模式（preset id：`runcode`）。

## 它做了什么

这是一个 dsh bundle（`dsh.bundle.patch` → `./cordis.patch.yml`）。补丁向宿主树插入一条
`@deepseek-ai/dsh-agent-preset` 行，注册 preset `runcode`，其插件列表为：

| 行 | 作用 |
| --- | --- |
| `persona`（`prefix: ''` + `complete: true` + `includeRuntimeContext: false`） | 让 system prompt 完全为空（零提示词） |
| `runcode-mode`（本包 `lib/index.js`） | 剥离插件注入的合成消息（无注入） |
| `tool-presentation`（`mode: ptc`） | 模型侧只暴露 `run_code` 一个工具 |
| `persistent-shell` 组（isolate terminals） | 持久 Shell（pty + bash/pwsh 持久工具，按平台启用） |
| `str-replace-editor` | 文件编辑器；直接使用**宿主平面的 fs-sandbox**（沙箱与审批策略生效） |

## 模型看到什么

- **没有 system 提示词**：`complete: true` 会把整条 system prompt 替换为空段，`renderPrompt` 过滤空段后得到空串。
- **只有一个工具**：PTC 呈现下模型只看到 `run_code` 的 schema（其 description 由 `dsh-tools` 动态拼出：`Execute a TypeScript program ... Call tools as await tools.name(args) ...` 加上 PTC runtime 的 executionInstructions 与工作目录句）。
- **没有注入**：本插件在 `agent/pre-step` 层把非对话来源（`plugin:*`、`time-context`、`skill-catalog` 等）的合成消息全部剥离。

### 程序里怎么知道有哪些工具

由于 system prompt 为空，模型看不到 SDK 声明。可在 `run_code` 程序里枚举：

```ts
return Object.keys(tools); // 已声明的工具名（pwsh、read、write、edit ...）
```

`tools` 是 null-prototype 命名空间对象，只定义了本 preset 挂载的工具名；调用未声明的名字会直接 `TypeError`。

## 与已有模式的对照（评审结论）

| 对比项 | 官方 `minimal` | 官方 `ptc` | 本地 legacy `bare`（无注入极简） | 本插件 `runcode` |
| --- | --- | --- | --- | --- |
| system prompt | 一句 persona | 完整 persona + 指令 | 一句 persona + 剥离注入 | **空**（`complete: true` + `prefix: ''`） |
| 模型可见工具 | 全部（native） | 仅 `run_code`（ptc） | 全部（native） | **仅 `run_code`（ptc）** |
| 无注入过滤 | 无 | 无 | 有（但 `kind==='plugin'` 在 0.2.0-rc.2 已不匹配） | 有（按白名单保留，能命中 `plugin:*`） |
| 文件工具 | 无 | `tool-fs` | `fs-local` + `str-replace-editor`（isolate，**绕过沙箱**） | `str-replace-editor` + 宿主 `fs-sandbox`（**沙箱生效**） |
| 上下文压缩 | 无 | `compaction` 组 | 无 | 无（见「已知取舍」） |

评审中修正的两个问题：

1. **注入过滤失效**：legacy `@local/dsh-no-injection` 只匹配 `source.kind === 'plugin'`，而 0.2.0-rc.2 里 Hindsight 注入的 kind 是 `plugin:hindsight`、时间上下文是 `time-context` —— 旧判定几乎命中不到。本插件改为**白名单**（保留 `user/model/tool/compact-checkpoint/user-approval/user-question-reply`，其余一律剥离）。
2. **文件写入绕过沙箱**：legacy `bare` 用 `fs-local` + `isolate{fs}`，此时 `ctx.fs.sandboxMode === undefined`，`str-replace-editor` 因此不经过 `sandboxPolicy`，写入可越过 workspace 限制。本插件去掉该隔离组，改用宿主 `fs-sandbox`，沙箱与审批策略正常生效（`dsh-tool-str-replace-editor` 在 `ctx.fs.sandboxMode` 有值时会强制要求 `sandboxPolicy`）。

## 已知取舍

- **零提示词 → 看不到 SDK**：这是需求本身决定的。程序内可用 `Object.keys(tools)` 枚举工具。
- **无上下文压缩**：长会话可能触及上下文上限。需要的话，把官方 ptc preset 里的 `compaction` 组（`compaction-basic` / `command-compact` / `tool-result-pruner`，带 `isolate: { compaction: true, toolResultPruner: true }`）复制进本 preset 的 `plugins` 即可。
- **不挂 skill/goal/subagent/todo/web**：极简定位；要加就往 `plugins` 里加对应工具行。

## 安装到本机 desktop profile

1. `dependencies` 加 `"@local/dsh-runcode-mode": "file:D:/dsh工作区1/dsh-runcode-mode"`，`dsh.profile.bundles` 追加 `"@local/dsh-runcode-mode"`。
2. 在 profile 目录执行 pnpm 安装（桌面端运行时 modules 目录被占用，需先关闭桌面端再 `dsh plugin --profile desktop install`）。
3. 重启桌面端，在模式选择器里选择「无提示词 run_code 模式」。

## 分发给别人 / 上传 GitHub

推荐让使用者用 DSH 的插件命令安装，命令会把包装进 profile 的 `node_modules` 并**自动把 bundle 加进 `dsh.profile.bundles`**（`reconcileProfilePlugins` 会自动启用新 bundle 依赖）。三种方式任选：

### 方式一：发布到 npm（最省事）

1. 把 `package.json` 的 `"private": true` 删掉或改 `false`；包名 `@local/dsh-runcode-mode` 的 `@local` 作用域你并不拥有，公开发布请改成你自己的作用域或去掉作用域（例如 `dsh-runcode-mode`）。
   **注意**：若改包名，务必同步修改 `cordis.patch.yml` 里 `- id: runcode-mode` 那一行的 `name:`（要与包名一致）。
2. `npm publish --access public`
3. 使用者执行：
   ```
   dsh plugin --profile desktop add dsh-runcode-mode
   ```
4. 重启桌面端，选「无提示词 run_code 模式」。

### 方式二：GitHub 仓库 + 直接从 git 安装

1. 把本目录推到 GitHub（见下方命令）。
2. 使用者执行（pnpm 支持 git 依赖，`@local/` 作用域无需改名）：
   ```
   dsh plugin --profile desktop add github:<你的用户名>/dsh-runcode-mode
   ```
   如需固定版本：`github:<用户>/<仓库>#v1.0.0`。
3. 重启桌面端选择该模式。

### 方式三：直接发压缩包 / tgz

- **tgz（推荐）**：`npm pack` 生成 `*.tgz`，发给对方后：
  ```
  dsh plugin --profile desktop add file:C:\path\to\dsh-runcode-mode-1.0.0.tgz
  ```
- **zip**：对方解压后，在其 profile `package.json` 的 `dependencies` 写 `"@local/dsh-runcode-mode": "file:<解压路径>"`、`dsh.profile.bundles` 追加包名，然后在 profile 目录 `pnpm install`（或 `dsh plugin --profile desktop install`），重启桌面端。

### 推到 GitHub 的具体命令

```bash
cd D:/dsh工作区1/dsh-runcode-mode
git init
git add .
git commit -m "feat: dsh runcode mode (no system prompt, run_code only)"
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-runcode-mode.git
git push -u origin main
```

> 提示：不同用户的 profile 可能使用不同 dsh 版本；本插件只依赖 `@deepseek-ai/dsh-*` 的公开服务与 `@deepseek-ai/cordis` 的插件协议，未固定 peer 版本，通常可跨 0.2.x 使用。若某版本缺少 `dsh-agent-tool-presentation` 或 `ptc-runtime`，该 preset 会挂载失败（在模式列表里显示为 broken）。

## 配置（可选）

`runcode-mode` 插件支持（在 preset 的该行 `config` 中提供）：

- `stripInjectedMessages`（默认 `true`）：设为 `false` 可关闭注入剥离。
- `keepKinds`（默认 `[]`）：额外保留的消息来源 kind 列表。

## 变更记录

### 2026-11-11 · workbuddy/deepseek-v4.1-flash

- 新建插件包 `@local/dsh-runcode-mode`（`D:\dsh工作区1\dsh-runcode-mode`）：`package.json`（`dsh.bundle.patch` → `./cordis.patch.yml`）、`cordis.patch.yml`（插入 preset `runcode`）、`lib/index.js`（`name='runcode-mode'`，导出 `apply`；在 `agent/pre-step` 用 `{prepend:true}` + `await next()` 剥离非对话来源的注入消息）。
- 已安装进 desktop profile：`package.json` 的 `dsh.profile.bundles` 与 `dependencies` 各加一项；包实体复制到 `profiles\desktop\node_modules\@local\dsh-runcode-mode`。
- 评审修正：① 注入过滤改为白名单（命中 `plugin:*`/`time-context` 等）；② 去掉 `fs-local`+`isolate{fs}`，改用宿主 `fs-sandbox`，使 `str-replace-editor` 经 `sandboxPolicy`（原写法可绕过沙箱）。
- 已验证：`loadOverlayPatches` 解析出 `preset-runcode`（`id=runcode order=13`）；`entryListProblem(plugins)` 返回 `undefined`；各行 config 通过对应 schemastery 校验；`loadProfileDirectory` 中本 bundle 成功解析。
- 未验证（需重启桌面端）：运行时实际 mount、模型侧是否只剩 `run_code`。
