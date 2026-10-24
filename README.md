# fknat-Tabby

此插件为 Tabby 添加 FKNAT SSH 配置，同时继续由 Tabby 原生 SSH 插件负责 SSH 身份
验证、主机密钥处理、SFTP、端口转发、Agent 转发和终端行为。插件界面会跟随 Tabby
的语言设置，并提供英文、简体中文和繁体中文显示。

插件会将导入的扣费 JSON 存储在对应平台的数据目录中：

- Windows: `%APPDATA%\\tabby-fknat\\secrets\\billing.json`
- Linux: `~/.config/tabby-fknat/secrets/billing.json`
- macOS: `~/Library/Application Support/tabby-fknat/secrets/billing.json`

原生辅助程序会在该目录旁创建并复用 `client.identity`。扣费 JSON 的内容绝不会写入
Tabby 配置或日志。辅助程序使用生产环境安全机制、自动发现和路由 `0`；其 stdout
专用于传输原始 SSH 字节流，诊断信息则写入 stderr。CA 请求使用
`https://ca.fknat.top`，并按现有部署要求跳过证书校验。

插件会把上述数据目录显式传给辅助程序的 `--config-dir` 参数，确保 Windows 上导入的
扣费 JSON、身份文件和诊断/SSH 连接使用同一目录。升级插件后，ProxyCommand 中应能看到
`--config-dir ...\\tabby-fknat`；如果没有该参数，说明仍在使用旧发布包。

辅助程序每次启动都会把诊断信息追加到数据目录下的 `logs/helper.log`，同时继续输出到
stderr。活动日志达到 10 MiB 后，会在下一次启动时压缩为 `.log.gz` 归档；最多保留最近
10 个压缩归档，生成第 11 个归档时自动删除最早的一个。扣费 JSON 内容不会写入日志。
即使 ProxyCommand 的父进程未提供可用的 stderr，文件日志仍会独立写入。

`helper.log` 会记录每次连接的阶段：身份准备、客户端准入、Relay 选择、Noise 握手、
route 0 打开和 SSH 字节流桥接。若能完成 Noise 但 `stage=dial_route` 超时，说明目标节点
可达但服务端 SSH route 或计费数据面没有恢复；这与本地 SSH Agent、私钥和 Tabby 插件加载
问题不同。

在 **Settings > FKNAT** 中导入扣费密钥后，创建一个 **FKNAT SSH** 配置，并填写由
64 个字符组成的 FKNAT 地址、SSH 用户名和身份验证方式。快速连接支持
`fknat://user@ADDRESS`。生成的原生 SSH 配置会将 FKNAT 地址作为主机密钥身份，并调用
插件内置的辅助程序，而不会把扣费密钥路径写入配置。

## 安装
在tabby插件目录下执行:

```shell
npm install --legacy-peer-deps 发布包名
```


## 开发

```sh
npm install --legacy-peer-deps
npm run typecheck
npm test
npm run build
cd helper && go test ./...
```

使用以下命令生成跨平台辅助程序二进制文件和 `bin/manifest.json`：

```sh
npm run build:helper
```

无需 SSH 客户端即可对辅助程序进行冒烟测试：

```sh
bin/linux-x64/fknat-tabby-helper version --json
bin/linux-x64/fknat-tabby-helper doctor
```

`doctor` 需要有效的本地扣费密钥才能执行真实的生产环境准入。添加
`--server-id ADDRESS` 后，还可以在不启动 SSH 身份验证的情况下检查目标的路由 `0`。

如果 Windows 设置页显示扣费授权已就绪，但诊断失败或连接日志提示 helper 找不到扣费
授权，请先安装最新的 `tabby-fknat-*.tgz`，完全退出并重启 Tabby，再重新运行诊断。

如果连接日志显示 `Agent auth selected, but no running Agent process is found`，说明当前
未找到 SSH Agent；`Automatic` 模式也可能输出该提示，不能仅凭它判断认证失败原因。
服务端只允许公钥认证时，后续应出现 `Trying private key`。可以选择 `Public key` 并填写
可用的私钥路径；只有已启动 `ssh-agent` 且已加载对应密钥时才选择 `Agent`。

FKNAT 会通过 Tabby 已注册的原生 SSH 配置提供器打开连接，确保自动发现私钥、认证和
SFTP 使用同一份 SSH 模块。`tabby/log.txt` 中会记录认证方式、显式私钥数量、密钥发现
方式以及使用的 SSH 提供器和组件；日志不包含密码或私钥内容。Windows 上该文件位于
`%APPDATA%\\tabby\\log.txt`，helper 日志位于
`%APPDATA%\\tabby-fknat\\logs\\helper.log`。Tabby 自身的主进程异常还可能记录在
`%APPDATA%\\tabby\\main-process-errors.log`。

如果普通 SSH 和 FKNAT 连接都无法保存，请检查 Tabby 的 `config.yaml` 是否可写。
Windows 默认路径是 `%APPDATA%\\tabby\\config.yaml`；只读属性会阻止所有连接配置保存，
也会导致认证设置在重启后丢失。解除只读后，在当前窗口重新保存即可。

## 发布包

`npm pack` 会运行 TypeScript 验证，并重新构建全部六个辅助程序目标。除 npm 包元数据
外，发布包仅包含 `dist/`、`bin/` 和本 README。`bin/manifest.json` 记录每个原生辅助
程序的 SHA-256 校验和；插件会在启动前验证所选的内置二进制文件。
