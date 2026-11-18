# Human Browser MCP

让 AI 用本机 Chrome 查看页面、点击、填表和传递文件。模型可以先看「销售明细」这类局部区域，批量完成筛选和下载，再从回执里核对结果。遇到画布等缺少文字控件的界面，可以按需截取一块图像并点击。

## 快速开始

安装 Node.js 22 或更高版本和桌面版 Chrome。克隆项目后执行以下命令。

```sh
git clone https://github.com/ChilsonX/human-browser-mcp.git
cd human-browser-mcp
npm ci
npm run --silent config
```

最后一条命令会生成包含当前机器 Node 和服务入口绝对路径的 MCP 配置。将其中的 `human-browser` 条目加入客户端并重新连接。Codex 用户也可以在项目目录用下面的命令注册。首次打开页面会启动独立 Chrome 窗口。[Codex MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

```sh
codex mcp add human-browser -- node "/absolute/path/to/human-browser-mcp/src/server.js"
```

本地演示页可以在项目目录启动。

```sh
npm run demo
```

保持该终端运行，把下面这句话发给已连接 MCP 的 AI。

> 使用 human-browser 打开 http://127.0.0.1:4173/reports，在销售明细中选择上月，等筛选生效后导出文件。在新的标签页打开 http://127.0.0.1:4173/import，上传刚刚导出的文件，并核对页面的接收回执。

报表页有两个同名的「导出」链接。导入页会检查文件名和实际字节，由此可以验证 AI 选对了报表。联动表单在 `/form`。在 `/visual` 可以让 AI 截取左上方的色板，选中蓝色色块并读取回执。按 Ctrl+C 可结束演示站点。

## 浏览器设置

默认会话使用临时浏览器配置，适合单独登录任务所需的网站。可选环境变量如下。

| 变量 | 用途 |
| --- | --- |
| `BROWSER_HEADLESS=1` | 使用无头 Chrome。 |
| `BROWSER_EXECUTABLE` | 指定 Chrome 或兼容 Chromium 的可执行文件。 |
| `BROWSER_CDP_URL` | 连接用户已开启调试的本机 Chrome 会话，例如 `http://127.0.0.1:9222`。该会话内的标签页都可被此客户端操作。 |
| `BROWSER_DOWNLOAD_DIR` | 指定下载目录。默认保存在项目的 `.browser-data/downloads/`，按次分目录以免同名文件覆盖。 |

## 工具

| 工具 | 输入和返回值 |
| --- | --- |
| `tabs` | `open` 打开网页。提供已有 ID 可以在原页导航。`list`、`focus`、`close` 管理标签页。`back`、`forward`、`reload` 控制历史导航。`accept`、`dismiss` 处理原生对话框。 |
| `observe` | 指定 `tab`。可用 `query` 筛选控件、文字、标题和区域名称。每次默认返回 24 行匹配结果，用 `offset` 翻页。`diff: true` 返回同一视图自上次查看以来的变化。 |
| `act` | 最多连续运行 16 步。支持 `click`、`hover`、`check`、`uncheck`、`fill`、`select`、`press`、`scroll`、`wait`、`download`、`upload`。完成后返回回执和上次观察范围内的变化。 |
| `visual` | `view` 获取当前视口图像，可用 `clip` 指定坐标和宽高。`click` 接收截图 ID 和图内坐标。每张图只能用于一次点击，点击前会重新核对取景区域。 |

例如，先调用 `observe({"tab":"t1","query":"销售明细"})`。假设返回的日期控件和导出链接分别是 `t1.1.e10` 和 `t1.1.e12`，就可以给 `act` 传入以下参数。实际调用应使用当次观察得到的引用。

```json
{
  "tab": "t1",
  "steps": [
    { "op": "select", "ref": "t1.1.e10", "value": "上月" },
    { "op": "wait", "value": "已应用上月" },
    { "op": "download", "ref": "t1.1.e12" }
  ]
}
```

`select` 使用界面显示的选项名称。`wait` 等待完整文字可见。`download` 在点击前监听下载，文件保存后返回文件 ID、名称、大小和实际路径。`upload` 将本次会话已保存的文件 ID 填入目标文件控件。提交成功应由网页回执确认。

批处理中断后，回执会列出已完成的步骤和出错位置。已经完成的步骤会保留效果。例如点击提交后等待回执超时，应先检查页面再决定是否重试。页面跳转、标签页不匹配、控件已被替换时，需要重新观察。

视觉模式使用当前视口的 CSS 像素，图像最大为 1600 × 1000。`clip.x` 和 `clip.y` 相对于视口左上角，点击坐标相对于截图左上角。选区持续变化的动画可能导致截图过期，可以缩小选区。默认文本流程不会返回截图。操作系统原生文件窗口仍由用户处理，网页文件输入框可使用 `upload`。

## 验证

```sh
npm test
npm run bench
```

测试通过标准 MCP 客户端启动服务，并在本机真实 Chrome 中操作本地页面。覆盖同名导出、异步联动表单、跨标签页文件传递、失效引用、弹窗、分页、差量回包、历史导航、勾选、悬停和画布坐标点击。测试会话与日常浏览会话独立。

对照脚本默认交替执行三轮，每轮使用新浏览器，预热后计时。对照组是微软的 `@playwright/mcp`，使用其局部查找和批量填表工具。两侧均检查下载内容、服务端保存的字段和接收的文件。每轮输出调用数、工具请求和回包 token、耗时及单独列出的工具目录大小。

token 采用 `o200k_base` 对工具名、参数和返回文本计数。计时包含浏览器执行、等待和结果核验。此基准使用固定动作脚本，模型推理、历史消息、重试选择及实际 API 账单需要另行测量。

2026-11-18 在 Windows、Chrome 157、Node 24 上测得下列三轮中位数。每轮包含上述三个任务，双方各完成 9/9 项。

| 每轮指标 | Human Browser MCP 0.2.0 | Playwright MCP 0.0.85 |
| --- | ---: | ---: |
| 工具调用 | 9 | 16 |
| 工具请求与回包 token | 1,059 | 2,932 |
| 执行耗时 | 1.01 秒 | 4.09 秒 |

## 许可

本项目采用 [MIT 许可证](LICENSE)。
