# 支付宝支付功能设计

## 目标

为 Auto Register Filler 插件接入支付宝电脑网站支付。当前商品为两档博客列表套餐，支付完成后不自动发货，由后台人工发货；插件首页展示用户的套餐状态。

## 套餐

| planId | 套餐名 | 金额 | 内容 |
| --- | --- | --- | --- |
| `blog_250` | 博客列表基础包 | 19.90 元 | 250 条博客列表，最终转化率 5%~10% |
| `as_50` | 高 AS 博客精选包 | 19.90 元 | 50 条 AS评分 > 50 的博客列表 |

前端仅展示套餐；后端套餐配置是价格和发货内容的权威来源。

## 支付环境

使用支付宝普通公钥模式，密钥格式为 `PKCS8`。

环境变量：

```text
ALIPAY_ENV=sandbox
ALIPAY_APP_ID=沙箱或正式应用 APPID
ALIPAY_PRIVATE_KEY=PKCS8 应用私钥
ALIPAY_PUBLIC_KEY=支付宝公钥
ALIPAY_KEY_TYPE=PKCS8
ALIPAY_NOTIFY_URL=https://jieyunsang.cn/api/alipay/notify
ALIPAY_RETURN_URL=https://jieyunsang.cn/api/alipay/return
```

网关：

```text
sandbox    -> https://openapi-sandbox.dl.alipaydev.com/gateway.do
production -> https://openapi.alipay.com/gateway.do
```

## 订单状态

| 状态 | 含义 | 是否允许创建新订单 |
| --- | --- | --- |
| `pending_payment` | 待支付 | 否 |
| `paid_pending_fulfillment` | 已支付，待人工发货 | 否 |
| `fulfilled` | 已发货 | 是 |
| `closed` | 已关闭 | 是 |
| `failed` | 异常或失败 | 是 |

同一用户在 `pending_payment` 或 `paid_pending_fulfillment` 阶段不允许购买多个套餐。

## 数据表

```sql
CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  out_trade_no VARCHAR(64) NOT NULL,
  alipay_trade_no VARCHAR(128) DEFAULT NULL,
  user_id VARCHAR(255) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending_payment',
  paid_at TIMESTAMP NULL DEFAULT NULL,
  fulfilled_at TIMESTAMP NULL DEFAULT NULL,
  raw_notify JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_orders_out_trade_no (out_trade_no),
  INDEX idx_payment_orders_user_status (user_id, status),
  INDEX idx_payment_orders_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

人工发货完成后，直接改数据库：

```sql
UPDATE payment_orders
SET status = 'fulfilled',
    fulfilled_at = NOW(),
    updated_at = NOW()
WHERE out_trade_no = 'AC...';
```

## 接口

### 创建支付订单

```text
POST /api/alipay/create-order
```

请求：

```json
{
  "userId": "user_xxx",
  "planId": "blog_250"
}
```

成功：

```json
{
  "success": true,
  "outTradeNo": "AC20260627...",
  "payUrl": "https://openapi-sandbox..."
}
```

存在待支付订单：

```json
{
  "success": false,
  "code": "ACTIVE_ORDER_EXISTS",
  "message": "你有一笔待支付订单，请先完成或等待订单关闭"
}
```

存在已支付待发货订单：

```json
{
  "success": false,
  "code": "PENDING_FULFILLMENT_EXISTS",
  "message": "你已有已支付订单，正在等待人工发货"
}
```

### 支付宝异步通知

```text
POST /api/alipay/notify
```

处理规则：

1. 使用支付宝公钥验签。
2. 校验订单存在。
3. 校验 `app_id` 和 `total_amount`。
4. `trade_status` 为 `TRADE_SUCCESS` 或 `TRADE_FINISHED` 时，将订单改为 `paid_pending_fulfillment`。
5. 返回纯文本 `success`。失败返回 `failure`。

只有 `notify_url` 是可信支付依据。

### 同步跳转展示

```text
GET /api/alipay/return
```

仅展示支付结果提示，不作为发货依据。

### 查询套餐状态

```text
GET /api/purchase-status?userId=xxx
```

返回：

```json
{
  "success": true,
  "status": "paid_pending_fulfillment",
  "statusText": "已支付，待人工发货",
  "planName": "高 AS 博客精选包",
  "paidAt": "2026-06-27T10:00:00.000Z",
  "fulfilledAt": null
}
```

无订单：

```json
{
  "success": true,
  "status": "none",
  "statusText": "未购买"
}
```

## 前端展示

设置页积分区域增加“套餐状态”：

```text
套餐状态：已支付，待人工发货
当前套餐：高 AS 博客精选包
```

支付页选择套餐后调用创建订单接口，拿到 `payUrl` 后通过 `chrome.tabs.create` 打开支付宝支付页面。
