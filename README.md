# t-DiskPilot

通用磁盘空间工具：扫描 / 清理 / 优化 / 建议。  
**不会自动执行**破坏性或改配置操作；一律「生成计划 → 勾选 → 输入 CONFIRM → 执行 → 写日志」。

## 要求

- Windows（主要目标）
- Node.js ≥ 18

## 安装与启动

```powershell
cd <repo-root>
npm install
npm start
```

浏览器打开：http://127.0.0.1:3789

可用环境变量 `PORT` 改端口。

## 功能

| 模块 | 说明 |
|------|------|
| **扫描** | 后台 Node 流式遍历；进度条（按已扫容量）、短面包屑、一行当前位置；可取消 |
| **清理** | 逐条勾选；低风险确认后可直接删；其余先入隔离区 |
| **优化** | 传递优化缓存、缩略图、回收站、存储感知等；均需确认 |
| **建议** | 如把 Pip/npm/Gradle 缓存迁到 D 盘；应用仍需 CONFIRM |
| **隔离区** | 默认 `D:\t-DiskPilot-quarantine\`；可还原或永久删除 |

## 扫描进度 UI

- **进度**：已扫描字节 / 盘符已用容量（扫整盘时）
- **面包屑**：`Users(3/15)/你的用户名(1/8)/AppData(2/20)` 形式，过长只留末尾几段
- **当前位置**：一行当前正在访问的路径
- UI 对进度推送做了约 150ms 消抖；服务端亦按时间/字节阈值节流

## 确认与隔离策略

1. UI 勾选要执行的项  
2. 先点「预演（dry-run）」查看计划（不改动磁盘）  
3. 再点「确认执行」，输入字面量 `CONFIRM` 才会真正执行  
4. **低风险目录**（Temp、Pip/npm 等）：确认后可直接删除内容  
5. **其余风险项**：先移到隔离区，测试后再永久删除或还原  

操作日志：`logs/ops-YYYYMMDD.log`（JSON 行）。

## API 摘要

### 异步扫描（推荐）

- `POST /api/scan/start` `{ drive?: "C", path?: "D:\\foo", hotspots?: true }` → 立即返回，后台扫描
- `GET /api/scan/progress` → `{ status, scannedBytes, totalBytes, percent, currentPath, breadcrumb, … }`
- `GET /api/scan/result` → 完成后的排行/热点
- `POST /api/scan/cancel` → 请求取消当前扫描

`status`: `idle` | `running` | `done` | `error` | `cancelled`

### 其它

- `GET /api/health`（扫描进行中仍可响应）
- `GET /api/drives`
- `GET /api/scan?drive=C`（兼容：启动异步任务并提示轮询）
- `GET /api/hotspots`
- `GET /api/clean/checklist` · `POST /api/clean/execute`
- `GET /api/optimize/checklist` · `POST /api/optimize/execute`
- `GET /api/suggest` · `POST /api/suggest/apply`
- `GET /api/quarantine` · `POST /api/quarantine/delete|restore`

## 安全说明

- 构建与自检请保持 `dryRun: true`
- 清 `C:\Windows\...` 时部分文件可能因占用/权限被跳过
- 扫描跳过 `$Recycle.Bin`、`System Volume Information` 等系统目录及符号链接/联接，避免死循环

## 参考

扫描可视化思路可参考同目录下的 SquirrelDisk；本项目为清单式 Web UI，便于勾选确认。
