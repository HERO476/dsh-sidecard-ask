# 运维与验收边界（2.3.4）

本文记录**降级/回滚**、**凭据落盘边界**与**端到端验收**三件运维必须知道的事。
它们都不是代码 bug，但每一条都能让一次正常操作留下永久后果。

---

## 1. 回滚到 ≤ 2.3.2 的两个数据面副作用

### 1.1 私网 SMTP 中继会被**永久删除**

2.3.2 在**加载期**就把不合格的中继值从层里剔掉
（`sanitizeLayer` 里直接 `delete`），2.3.3 起改成“加载期保留、发送期拒绝”。
所以把版本退到 ≤ 2.3.2 后，只要用户**保存一次任意设置**，下一次写入就会把
`feedbackSmtpHost` 里那个私网地址彻底删掉——不是禁用，是从文件里消失。

**回滚前必做**：导出当前配置。

```bash
# Linux / macOS
cat "$DSH_HOME/sidecard-ask/config.${DSH_PROFILE:-default}.json"
# Windows PowerShell
Get-Content "$env:USERPROFILE\.dsh\sidecard-ask\config.<profile>.json"
```

### 1.2 `schemaVersion` 会变成“未知配置项”

2.3.1 及更早没有这个常量。回滚后第一次保存会走 `backupIfDroppingKeys`：
出现一条“保存会丢弃未知配置项（schemaVersion），已备份到 backup”的告警，
并留一份 `.bak-*` 副本。**配置数据不丢**，只是多一条告警 + 一个备份文件。

### 1.3 `/diag` 行为随版本变化

| 目标版本 | `GET /sidecard-ask/api/diag` |
|---|---|
| 2.3.3 | 200；字段 `at,authGate,config,fenceDelegation,readonly,route,version` |
| 2.3.4 | 200；新增 `routesRegistered`，且**只对本机回环开放**（LAN 直连 403） |
| 2.3.2 | **恒定裸 400**（空 body、无 content-type）——这是那一版的发布事故 |
| ≤ 2.3.1 | 404（端点不存在） |

回滚到 2.3.2 之前，确认没有监控/脚本依赖 `/diag` 的 200。

---

## 2. 凭据落盘的边界（SMTP 密码）

配置文件里保存着 SMTP 密码**明文**。代码做了两件事：

- `mkdirSync(dir, { mode: 0o700 })` 与 `writeFileSync(temp, { mode: 0o600 })`；
- 备份文件同样 `chmod 0o600`。

**在 Windows 上这两个 mode 位是空操作**。实际保护等于
`%USERPROFILE%\.dsh` 目录继承下来的 ACL。由此有两条实际风险：

1. 该目录若落在 OneDrive / 漫游配置里，凭据会离开本机；
2. `.bak-*` 备份同样含密码，清理时不要只删主文件。

**更安全的做法**：不要往配置文件里写密码，改用
`DSH_SIDECARD_SMTP_URL`（含账号密码的 URL 形式）由进程环境提供，
配置文件里只留主机/端口/发件人。

检查有效权限：

```powershell
icacls "$env:USERPROFILE\.dsh\sidecard-ask\config.json"
```

```bash
ls -l "$DSH_HOME/sidecard-ask/"            # 期望 -rw-------
```

---

## 3. `engines.dsh` 的读法

```
>=0.2.1-rc.5 <0.3.0-0 || >=0.2.2-0 <0.3.0-0
```

两个备选是因为 semver 的预发布规则：

- 宿主自己用 `{ includePrerelease: true }` 判定，第一段就够；
- **标准 semver 消费方**（pnpm 的 engines 检查、市场校验、CI）默认不匹配
  预发布版本，除非 range 里有一个同 `major.minor.patch` 的预发布下界——
  这正是第二段 `>=0.2.2-0` 的作用。

实测（semver 7.8.6，两种 flag）：

| 版本 | 默认 | includePrerelease |
|---|---|---|
| 0.2.1-rc.5 | ✅ | ✅ |
| 0.2.2-rc.3 / rc.5 | ✅ | ✅ |
| 0.2.2 | ✅ | ✅ |
| 0.3.0-0 / 0.3.0-rc.1 | ❌ | ❌ |

---

## 4. 端到端验收（当前无自动化，必须人工）

CI 跑的是替身 harness，**不是**真宿主、真 Electron、真 WebView。以下四项必须人工过：

| # | 环境 | 步骤 | 期望 |
|---|---|---|---|
| E1 | 桌面（Electron 外壳） | 选中聊天文本 → 提问 | 侧卡出现并流式作答 |
| E2 | 桌面 | 设置页改 `maxChars` → 保存 → 重开设置页 | 值仍在（证明围栏委派写通） |
| E3 | 桌面 / 手机网页版 | 历史面板删一行 → **取消** | 记录必须还在 |
| E4 | 任意 WebView（`window.confirm` 不存在） | 点“清空全部” | 弹自家确认层，**不清空**；确认后才清 |

补充已知边界：

- **历史记录是 per-origin 的**：`dsh-app://` 与 `http://127.0.0.1:<端口>` 是两份
  独立存储，桌面删一条，网页端仍在。这是既定设计（设置页文案已写明），
  不是“删除没生效”。
- **`dsh-app://` 直连端口不受支持**：桌面页必须走文档相对路径
  （`dsh-app://app/sidecard-ask/api/...`），由主进程的 `forwardWebRequest`
  去掉 Origin 并注入 cookie。带 `Origin: dsh-app://app` 直连 HTTP 端口的请求
  在 2.3.4 起被插件直接 403（`desktop-origin`）——宿主的信任检查本来也只认
  http/https，放行只会制造“桌面直连可用”的错觉。
