# Cloudflare 部署：按顺序操作

## 先分清部署入口

本项目含数据库、管理登录、订单与自动交付，部署目标是 **Cloudflare Workers + D1**。不要拖进 Pages 的“上传静态文件”入口，ZIP 本身也不是可执行程序。

提供两种路径：网页按钮部署，或 Windows 脚本部署。第一次需要登录你的 Cloudflare、配置两项秘密；后续代码更新可以自动构建。

## 路径一：GitHub → Cloudflare（推荐）

1. 打开仓库首页，点击 **Deploy to Cloudflare** 按钮，登录 Cloudflare。
2. 选择部署账号并授权 GitHub。如果按钮引导你复制仓库，按页面完成；复制后的代码仍是你的项目。
3. 选择 Workers 部署，根目录保持 `/`。检查以下构建设置：

| 字段 | 值 |
| --- | --- |
| Node 版本 | 24（构建变量 `NODE_VERSION=24`） |
| 构建命令 | `npm run build` |
| 部署命令 | `npm run deploy` |
| Worker 名称 | `chongqi-commerce`（可修改根配置中的 `name`） |
| D1 绑定 | `DB` |

4. Cloudflare 的部署按钮支持按 `wrangler.json` 自动创建所需 D1。若普通 GitHub 导入未自动创建，本项目部署脚本会查找 / 创建 `chongqi-commerce-db` 并运行迁移。所用构建令牌需要 Workers 编辑与 D1 编辑权限。
5. `.dev.vars.example` 声明了两项初始化秘密，以及可选的支付查询密钥。按页面填写；如果界面没有显示该步骤，部署后进入 **Worker → Settings → Variables and Secrets**，添加以下两项，类型选择 **Secret**：

| 名称 | 填什么 | 用途 |
| --- | --- | --- |
| `INVENTORY_KEY` | 64 位十六进制随机串（只含 0–9、a–f） | 加密库存卡密 |
| `BOOTSTRAP_TOKEN` | 你生成的随机初始化令牌 | 首次创建店主账号 |

在装有 Node 的电脑上执行下面命令，每执行一次都会产生一个新的随机值。执行两次，分别填写到两个 Secret；不要把这两个值提交到 GitHub：

```bash
node scripts/generate-secret.mjs
```

6. 保持普通环境变量 `DEMO_MODE=false`；收款未配置前让 `PAYMENT_PROVIDER` 为空或 `disabled`。准备启用 USDT 时按 [支付配置](PAYMENTS.md) 设置。
7. 保存并部署设置。打开 Cloudflare 给出的 `https://…workers.dev` 地址，再访问该地址后面的 `/admin`。
8. 输入 `BOOTSTRAP_TOKEN`，创建自己的店主账号和至少 12 位的密码。成功后，在 Cloudflare 删除 `BOOTSTRAP_TOKEN` 并重新部署；系统也会在数据库中阻止再次初始化。
9. 在后台新建分类、商品，导入自己的可销售库存，填写站点服务信息。初始空商城没有真实商品与默认账号。
10. 在 Worker 的 Settings → Domains & Routes 中添加自己的域名。

**数据库 ID 持久化**：部署按钮通常会更新配置中的 ID。普通构建首次创建数据库后，请在 Cloudflare D1 页面复制该数据库 ID，填入仓库 `wrangler.json` 的 `database_id`，以后始终复用它。脚本在占位 ID 时按数据库名称查找，避免重复建库；不要在改名时意外新建空数据库。

## 路径二：Windows 脚本

1. 安装 [Node.js 24 LTS](https://nodejs.org/)，安装时保留 npm 选项。
2. GitHub 仓库 → Code → Download ZIP。下载后 **完整解压**，不要在 ZIP 内运行文件。
3. 双击解压目录里的 **deploy-windows.cmd**。脚本会检查 Node、安装依赖、构建网站、打开浏览器让你登录 Cloudflare，再创建数据库并部署。
4. 等待终端显示部署网址。第一次安装可能花费几分钟。
5. 按路径一的第 5–10 步配置 Secret、初始化管理员、上架商品。

脚本开头与命令均使用英文 ASCII，避免 Windows 批处理编码问题；异常时窗口会保留错误信息，不会继续部署。

## 常见问题

- **提示“不是内部或外部命令”**：确保已经安装 Node 24，并重新打开终端；确认解压完整且运行的是 `.cmd`，不是 `.zip` 或 `.mjs`。
- **Pages 上传不支持文件**：入口不适用。返回 Workers & Pages，创建 **Worker** 并连接 GitHub，或使用仓库部署按钮。
- **数据库未配置 / 页面服务不可用**：检查绑定名是否为 `DB`、D1 的 ID 是否有效、迁移是否成功执行。访问 `/api/health` 应返回 `ok: true`。
- **库存加密密钥未配置**：检查 `INVENTORY_KEY` 是否为 64 位十六进制且类型是 Secret。
- **管理员初始化令牌不正确**：核对 Secret 与输入值，确认设置已经重新部署。
- **后台出现演示入口**：说明 `DEMO_MODE` 为 `true`。演示与正式环境必须使用不同 Worker 和不同数据库；不要把已开放演示入口的数据库直接改成生产。
- **支付不能使用**：TRC20 USDT 请按 [支付配置](PAYMENTS.md) 填写收款地址、汇率和查询密钥，并核对每分钟 Cron Trigger。微信 / 支付宝仍未接入。

## 后续更新与回滚

以后提交代码到 Cloudflare 连接的分支即可触发构建。迁移只新增，不修改已应用的文件。Cloudflare 的代码版本回滚不等于数据库回滚；数据库恢复使用 D1 Time Travel，先确认订单与库存恢复点。`INVENTORY_KEY` 要另行安全保存，丢失或直接更换会导致已有卡密无法解密。

参考官方文档：[部署按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) · [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [D1](https://developers.cloudflare.com/d1/)
