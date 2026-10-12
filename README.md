# 重启 · RESTART 数字商品商城

面向中文用户的数字商品商城与运营后台。基于 React、Vinext、Cloudflare Workers 和 D1，包含真实持久化的数据接口。已集成 TRON 主网 TRC20 USDT 直收，未配置时关闭收款。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/trandainho27-source/chongqi-1)

> 这是可继续运营开发的工程第一版。USDT 收款需先完成商家配置与实收测试；演示商品不提供真实第三方账号、授权或服务。正式运行请关闭演示模式，填写自己的商品与服务信息。

## 从哪里开始

- **想先看网站**：打开本项目交付的私有体验地址；商家后台点击「进入演示管理后台」。
- **想部署到自己的 Cloudflare**：先阅读 [中文部署指南](docs/DEPLOY.md)。点击上面的按钮，或在 Windows 中解压仓库后运行 `deploy-windows.cmd`。
- **想管理商品**：网站 `/admin` → 分类 → 商品 → 库存。商品不会凭空产生可售库存，需导入实际交付内容。
- **想接入支付**：阅读 [支付接口说明](docs/PAYMENTS.md)。

## 已实现

| 模块 | 功能 |
| --- | --- |
| 中文商城 | 响应式页面、分类、关键词与地区搜索、排序、库存筛选、商品详情、购买说明 |
| 购物车 | 本机购物车、多商品下单（最多 12 种）、最小 / 最大数量、联系方式、购买协议 |
| 订单 | 服务端计算金额、15 分钟付款窗口、USDT 确认宽限、随机查询密钥、本机记录、过期释放 |
| 数字交付 | 批量导入、自动去重、AES-GCM 加密保存、确认收款后事务发货、复制与 TXT 下载 |
| 商品后台 | 分类、商品、价格、上下架、推荐、地区、说明、库存汇总 |
| 订单后台 | 订单号与状态过滤、分页、当前页 CSV 导出、店主确认线下收款、登记退款 |
| 售后 | 凭订单密钥提交工单、客服回复、关闭工单、客户查看处理结果 |
| 权限 | 店主 / 运营 / 客服、密码登录、8 小时会话、修改密码、停用员工 |
| 运营 | 成交趋势、待办、库存预警、站点公告、品牌、协议、服务信息、操作日志 |
| USDT 支付 | TRC20 支付单、二维码、锁定汇率、到账核验、后台巡检、交易补查、异常对账、重复事件幂等 |

商品模型采用「一个商品对应一个可售规格」：不同地区、年限、套餐分别建商品，适合数字商品目录。分类可自由新增和改名，账号类型也可自行创建。示例内容采用数字账号、订阅、资源及授权等数字商品，不复制参考站的商品数据。

## 本地开发

需要 Node.js **24 LTS**（测试依赖 Node 内置 SQLite）。

```bash
npm run install:ci
npm run typecheck
npm test
npm run build
npm run verify:worker
```

安装脚本会通过 npm 自动运行固定版本 pnpm，并使用仓库 `pnpm-lock.yaml`；不需要你单独安装 pnpm。

本地预览 D1 数据库需先构建，再依次应用所有迁移：

```bash
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config wrangler.json --persist-to .wrangler/state
```

本地运行时从 `.dev.vars` 读取秘密；不要提交该文件。本地开发服务器请运行 `npm run dev`。部署版本默认关闭演示模式，不存在通用默认密码。

## 工程说明

- `app/`：商城、帮助、订单、管理后台及 API 路由。
- `lib/commerce/`：订单事务、权限、加密、安全工具和示例内容。
- `db/schema.ts`、`drizzle/`：D1 表结构、索引、事务守卫约束及迁移记录。
- `wrangler.json`：自有 Cloudflare 账户的部署配置；`DB` 为数据库绑定名。
- `.openai/hosting.json`：私有体验站使用的 Sites 配置，不用于识别你的 Cloudflare 账户。
- `scripts/deploy-cloudflare.mjs`：建立 / 复用数据库、应用迁移、部署 Worker。
- `tests/commerce.test.ts`：交易、库存、权限、加密及支付回调测试。

支付退款的“登记”只记录已经完成的退款，不会自动调用支付平台。已交付卡密不会回到可售库存。库存释放在商城 / 订单 / 后台请求及已启用的支付巡检中进行；未启用巡检的环境由下一次请求清理。

目前未提供会员注册、钱包充值、分销结算、供应商采购、多商户隔离、邮件 / 短信通知、自动支付退款、文件上传交付。生产大流量压力测试、灾备演练和外部安全审计尚未进行。架构和数据保护已实现，不能据此声称已通过企业认证或安全审计。

部署与操作：[DEPLOY.md](docs/DEPLOY.md) · 支付：[PAYMENTS.md](docs/PAYMENTS.md) · 运营：[OPERATIONS.md](docs/OPERATIONS.md) · 架构：[ARCHITECTURE.md](docs/ARCHITECTURE.md)
