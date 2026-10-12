# TRC20 USDT 收款配置与对账

本项目已实现 TRON 主网 USDT 直收：钱直接进入商家自己的钱包，TronGrid 只提供链上查询。网站不保存钱包私钥、助记词，不签名转账、不归集、不自动退款。未完成配置时关闭收款；演示环境始终禁止真实付款。

## 正式启用：填写四项配置

在独立的生产 Cloudflare Worker → Settings → Variables and Secrets 中设置：

| 名称 | 类型 | 填写内容 |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | 普通变量 | `trc20` |
| `TRON_RECEIVING_ADDRESS` | 普通变量 | 自己控制的、支持 TRON 主网 USDT 的 T 开头收款地址 |
| `USDT_CNY_RATE` | 普通变量 | 商家设定的「1 USDT 折合多少人民币」，十进制数，最多 6 位小数；不是自动市场行情 |
| `TRONGRID_API_KEY` | Secret | 在 [TronGrid](https://www.trongrid.io/) 创建的查询 API Key |

同时保持 `DEMO_MODE=false`，正确配置 `DB` 与 `INVENTORY_KEY`。后台「支付接口」会分别显示配置状态；配置状态只校验存在性和格式，不等于已经通过主网实收测试。请使用独立的商家收款地址，不要填 USDT 合约地址，也不要与其他依赖金额尾差识别的系统共用地址。地址做 Base58Check 校验，但系统不能证明你拥有它，务必在自己的钱包中核对。

无需向任何人提供钱包私钥、助记词或钱包密码。API Key 不写入 GitHub，也不粘贴到网站前端。`INVENTORY_KEY` 是原有库存加密密钥，不能为了开支付重新生成或替换。

设置保存后重新部署，在后台检查状态。根 `wrangler.json` 使用 `keep_vars=true`，保留在 Cloudflare 后台填写的支付变量；默认不在仓库中启用收款。

## 客户付款流程

1. 客户下单，服务器按商品真实售价计算人民币金额并锁定库存 15 分钟。
2. 在订单页点击「生成 USDT 支付单」。服务器锁定汇率和金额；刷新、重复点击都返回同一支付单。
3. 应付 USDT = 人民币金额 ÷ 商家汇率，向上取至 6 位小数，再加 0–0.009999 USDT 识别尾差。页面在转账前显示完整金额、尾差和锁定汇率。尾差区分订单，不能删去或取整。
4. 扫码或复制地址。二维码仅含地址；客户在钱包选择 **USDT、TRON/TRC20 主网**，手动填写完整金额，一次到账。钱包或平台的手续费另付，实际到账金额应与支付单相同。
5. 页面每 20 秒检查；Cloudflare 的后台巡检每分钟运行。只有链上固化且执行成功的官方 USDT 转账才能发货。
6. 可粘贴 64 位交易哈希 TxID 补查。点击「我已转账」或提交交易哈希本身不会变成已支付。

支付截止仍是原订单的 15 分钟截止时间。生成支付单后，库存再保留 10 分钟，供已发出的转账完成确认；此时不再接受新转账。支付单生成后不可立即取消并释放库存。超时后才识别的款项进入人工核对，不重新分配库存。

## 自动巡检

部署到自己的 Cloudflare 时，根 `wrangler.json` 已包含 `triggers.crons=["* * * * *"]`，Worker 导出 `scheduled` 处理器。部署后在 Cloudflare 的 Cron Triggers 中检查配置与执行记录；新配置传播可能需要时间。

每次扫描按收款地址读取历史，保存分页指纹和固定时间窗口；成功完成一页后才推进游标。按交易事件去重，整笔交易的全部日志处理完成后才记为已扫描。单次限制工作量，剩余分页留待下一次，失败自动重试。数据库租约防止客户页面和 Cron 同时重复扫描。正常扫描有 10 分钟重叠窗口，以覆盖确认和索引延迟。

当前私有 Sites 体验站用于演示，真实收款关闭；不能把 Cloudflare 配置文件的存在视为 Sites 已开通 Cron。付款页面检查不等于无人值守巡检，正式启用前必须验证目标 Worker 的定时触发器。

暂停新支付：将 `PAYMENT_PROVIDER` 设为 `disabled`。已存在支付单仍会在非演示环境、查询密钥可用时继续对账，避免遗漏暂停前的转账。更换收款地址只影响新支付单，旧地址继续监控；不要删除旧地址的监控和历史账单。

## 校验与记账

- 固定主网节点 `https://api.trongrid.io` 和官方合约 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`。不按 USDT 名称或图标识别，不支持其他网络同名资产。
- 同时核验 `/walletsolidity/gettransactionbyid` 和 `/walletsolidity/gettransactioninfobyid`，要求交易 ID 匹配、执行成功、日志来自官方合约。
- 解码 `Transfer` 日志，核对收款地址、整数微 USDT 金额、区块时间与支付有效期。涉及收款地址同时支出的复合交易或自转账不自动入账。
- 以 `txID:logIndex` 唯一识别到账；按实际地址与金额查找支付单，客户不能用别人的 TxID 给自己的订单付款。
- 收款地址 + 应付金额永久唯一，不因过期回收。这样避免很晚的付款误撞新订单。同一基础报价每个地址最多有 10,000 个尾差候选，接近耗尽时需更换专用收款地址；高交易量、多商户场景应改用每单独立地址或专业网关。
- 链上收据、支付确认、订单状态、库存交付和审计在同一 D1 batch 事务中完成。冲突时整体回滚，保存人工核对记录。
- 金额不符、重复付款、过期或已取消订单到账进入对账记录，不自动拆单、补单、充值或退款。

## 后台日常操作

店主 → 支付接口：查看配置、最近扫描结果、最近 50 张支付单和最近 50 条到账 / 异常记录；点击「立即对账」，或按订单号和 TxID 补查。运营和客服不能操作支付对账。

发现异常后，通过链上交易和客户工单核对。补查对照实际地址和金额，不会强制把一笔不匹配的款项记到输入的订单。只有核对真实到账且订单仍可交付时，店主才可在订单管理中登记线下确认。超时订单、少付、多付、重复支付需人工安排后续处理；不要通过改数据库恢复旧订单。

退款需商家在自己的钱包中操作。系统没有发币能力。已发货订单可在订单管理登记已完成的退款；未发货的到账异常可通过订单工单记录处理依据，交付卡密不会重新上架。

## 接口

| 接口 | 权限与作用 |
| --- | --- |
| `POST /api/payments/create` | 订单号 + 查询密钥；创建幂等支付单，服务器决定地址和金额 |
| `POST /api/payments/check` | 订单号 + 查询密钥，可带 `txId`；扫描或定向核验，返回本订单最新状态 |
| `GET /api/admin/payment` | 店主会话；脱敏配置状态、支付单、对账记录、监控状态 |
| `POST /api/admin/payment` | 店主会话 + CSRF；扫描或按 `orderId`、`txId` 补查 |

所有客户写接口检查同源 Origin，订单凭证、IP 限速，支付响应不缓存。查询节点超时或限流返回可重试错误，不能据此认定未付款。补查可以覆盖长时间索引延迟，极端节点遗漏仍需商家对账。

原有 `/api/payments/webhook` 自定义 HMAC 回调保留，仅 `PAYMENT_PROVIDER=custom-hmac` 且配置 `PAYMENT_WEBHOOK_SECRET` 才启用，不参与 TRC20 直收。回调原文协议是 `${timestamp}.${rawBody}` 的 HMAC-SHA256，时间戳为 Unix 秒、允许 300 秒偏差；请求包含 `orderId/status=paid/currency=CNY/amount=整数分/transactionId`。这不是微信、支付宝或 TronGrid 的回调协议。

## 上线前的实收验证

代码测试使用模拟链上数据，不会替你转账。正式启用需先完成独立生产部署、真实地址核对、API Key 连通性验证和 Cron 触发验证，再由商家自行做小额实际付款，核对到账金额、自动发货与后台流水。当前未完成主网实收测试、生产压力测试或外部安全审计。

官方依据：[Tether 支持的协议](https://tether.to/en/supported-protocols/) · [TRON 确认语义](https://developers.tron.network/docs/confirmation-semantics) · [TRC20 历史](https://developers.tron.network/reference/get-trc20-transaction-info-by-account-address) · [事件日志](https://developers.tron.network/docs/event) · [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
