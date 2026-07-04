# CSV 购买与下载权限设计

## 背景

当前支付流程在支付宝异步通知成功后，将订单置为 `paid_pending_fulfillment`，后续还需要人工处理。新目标是由后端定时任务从 `blog_run_stats` 表导出可售 CSV 文件，用户在插件购买页选择某个 CSV，支付成功后获得该 CSV 的下载权限。

已确认约束：

- 自动导出的数据源是 `blog_run_stats`。
- 导出排序和切分依据是 `blog_run_stats.created_at`。
- 一个 CSV 可以卖给多个用户。
- 同一用户不能重复购买同一个 CSV。
- 用户买完后在插件内直接下载 CSV。
- 下载请求必须携带购买凭证。
- 文件命名和售卖列表都必须体现 CSV 内 `created_at` 的日期范围，例如 `blogs_20260601_20260701.csv`。

## 总体方案

引入三类对象：

- `csv_batches`：一个可售 CSV 文件批次。
- `csv_batch_items`：一个批次中包含的 `blog_run_stats` 行，用于防止同一条数据重复导出。
- `user_csv_purchases`：用户对 CSV 批次的购买和下载授权记录，用于防止同一用户重复购买同一 CSV。

支付宝订单 `payment_orders` 增加 `batch_id` 字段。前端下单时传入 `batchId`，支付成功后支付宝异步通知在数据库事务中完成“确认支付 + 创建购买凭证 + 授予下载权限”。购买记录本身就是下载权限，不再设计额外的交付动作。

## 文件存储

建议服务端生成的 CSV 放在：

```text
storage/csv-batches/
```

文件命名：

```text
blogs_YYYYMMDD_YYYYMMDD.csv
```

示例：

```text
storage/csv-batches/blogs_20260601_20260701.csv
```

两个日期分别来自该 CSV 内数据的 `MIN(blog_run_stats.created_at)` 和 `MAX(blog_run_stats.created_at)`。如果极端情况下同一个日期范围生成了多个文件，为避免文件名冲突，可以追加序号：

```text
blogs_20260601_20260701_0002.csv
```

CSV 文件属于真实售卖数据，不应提交到 Git。`.gitignore` 应忽略：

```gitignore
/storage/csv-batches/
```

## 数据库设计

### csv_batches

```sql
CREATE TABLE IF NOT EXISTS csv_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_no VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  row_count INT NOT NULL,
  source_start_date DATE NOT NULL,
  source_end_date DATE NOT NULL,
  source_started_at TIMESTAMP NOT NULL,
  source_ended_at TIMESTAMP NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 19.90,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_csv_batches_batch_no (batch_no),
  UNIQUE KEY uk_csv_batches_file_name (file_name),
  INDEX idx_csv_batches_date_range (source_start_date, source_end_date),
  INDEX idx_csv_batches_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='可售 CSV 批次';
```

`status` 建议枚举：

- `building`：正在生成，前端不可购买。
- `ready`：可购买。
- `disabled`：下架，已购买用户仍可下载。
- `failed`：生成失败。

### csv_batch_items

```sql
CREATE TABLE IF NOT EXISTS csv_batch_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  blog_run_stat_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_csv_batch_items_source_once (blog_run_stat_id),
  UNIQUE KEY uk_csv_batch_items_batch_source (batch_id, blog_run_stat_id),
  INDEX idx_csv_batch_items_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CSV 批次包含的 blog_run_stats 行';
```

这里的核心是 `uk_csv_batch_items_source_once`。它保证同一条 `blog_run_stats` 数据只会被导出到一个 CSV 批次里。不要只依赖“上次导出时间”，因为定时任务重复运行、服务重启、补数据、边界时间相同都会导致重复风险。

### user_csv_purchases

```sql
CREATE TABLE IF NOT EXISTS user_csv_purchases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(255) NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  out_trade_no VARCHAR(64) NOT NULL,
  purchase_token_hash VARCHAR(64) NOT NULL,
  paid_at TIMESTAMP NULL DEFAULT NULL,
  granted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_csv_purchases_user_batch (user_id, batch_id),
  UNIQUE KEY uk_user_csv_purchases_trade_no (out_trade_no),
  UNIQUE KEY uk_user_csv_purchases_token_hash (purchase_token_hash),
  INDEX idx_user_csv_purchases_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户 CSV 购买和下载权限记录';
```

`uk_user_csv_purchases_user_batch` 用于防止同一用户重复购买同一个 CSV。因为一个 CSV 允许卖给多个用户，所以不能给 `batch_id` 单独加唯一约束。

### payment_orders 变更

```sql
ALTER TABLE payment_orders
  ADD COLUMN batch_id BIGINT UNSIGNED NULL COMMENT '购买的 CSV 批次ID' AFTER plan_id,
  ADD INDEX idx_payment_orders_batch_id (batch_id);
```

后续可以保留 `plan_id` 兼容旧逻辑，也可以将新订单统一写成 `plan_id = 'csv_batch'`。

## 定时导出任务

建议使用 `node-cron` 或直接在服务启动后使用一个带分布式锁的定时器。因为当前部署可能用 PM2，必须防止多进程重复导出。

推荐每天凌晨执行：

```text
02:00 Asia/Hong_Kong
```

生成规则：

1. 获取 MySQL 命名锁，例如 `GET_LOCK('csv_batch_export', 5)`。
2. 查询未导出的 `blog_run_stats`：

```sql
SELECT s.*
FROM blog_run_stats s
LEFT JOIN csv_batch_items i ON i.blog_run_stat_id = s.id
WHERE i.id IS NULL
ORDER BY s.created_at ASC, s.id ASC
LIMIT 250;
```

3. 如果不足 250 条，不生成 CSV。
4. 如果达到 250 条：
   - 先创建 `csv_batches`，状态为 `building`。
   - 根据选中的 250 条数据计算 `source_start_date`、`source_end_date`、`source_started_at`、`source_ended_at`。
   - 生成包含日期范围的文件名，并将 CSV 写到临时路径。
   - 计算 `sha256`。
   - 在事务中插入 `csv_batch_items`。
   - 将临时文件原子重命名到正式路径。
   - 更新 `csv_batches.status = 'ready'`。
5. 释放 MySQL 锁。

如果希望一次任务处理多个 250 条批次，可以循环执行，直到剩余未导出数量不足 250。

推荐 CSV 表头保持和插件批量页兼容：

```text
页面AS,原URL,URL对应域名,目标域名,类型,外部链接数量,验证结果,记录时间
```

字段映射：

- `page_as` -> 页面AS
- `original_url` -> 原URL
- `url_domain` -> URL对应域名
- `target_domain` -> 目标域名
- `link_type` -> 类型
- `external_link_count` -> 外部链接数量
- `validation_result` -> 验证结果
- `created_at` -> 记录时间

## API 设计

### 查询可购买 CSV 列表

```text
GET /api/csv-batches?userId=xxx
```

返回：

```json
{
  "success": true,
  "batches": [
    {
      "batchId": 12,
      "batchNo": "BLOGS_20260601_20260701",
      "fileName": "blogs_20260601_20260701.csv",
      "dateRangeText": "2026-06-01 至 2026-07-01",
      "sourceStartDate": "2026-06-01",
      "sourceEndDate": "2026-07-01",
      "rowCount": 250,
      "price": "19.90",
      "createdAt": "2026-07-04T02:00:00.000Z",
      "purchaseStatus": "available"
    },
    {
      "batchId": 11,
      "batchNo": "BLOGS_20260501_20260531",
      "fileName": "blogs_20260501_20260531.csv",
      "dateRangeText": "2026-05-01 至 2026-05-31",
      "sourceStartDate": "2026-05-01",
      "sourceEndDate": "2026-05-31",
      "rowCount": 250,
      "price": "19.90",
      "createdAt": "2026-07-03T02:00:00.000Z",
      "purchaseStatus": "purchased"
    }
  ]
}
```

`purchaseStatus`：

- `available`：可购买。
- `purchased`：当前用户已购买，可下载。
- `disabled`：已下架，不可新购。

### 创建支付订单

```text
POST /api/alipay/create-order
```

新请求：

```json
{
  "userId": "user_xxx",
  "batchId": 12
}
```

创建前校验：

- `batch_id` 存在且 `csv_batches.status = 'ready'`。
- 用户没有购买过该 `batch_id`。
- 同一用户没有未关闭的 `pending_payment` 订单。若有相同 `batch_id` 的待支付订单，可复用；若是不同 `batch_id`，前端提示先取消或完成当前订单。

订单金额必须来自后端 `csv_batches.price`，前端展示价格不能作为可信来源。

### 支付成功授予下载权限

支付宝 `notify` 中，`TRADE_SUCCESS` 或 `TRADE_FINISHED` 后执行事务：

```sql
START TRANSACTION;

SELECT *
FROM payment_orders
WHERE out_trade_no = ?
FOR UPDATE;

SELECT *
FROM csv_batches
WHERE id = ?
FOR UPDATE;

-- 校验订单金额、batch 状态、用户是否已购买

INSERT INTO user_csv_purchases (
  user_id,
  batch_id,
  out_trade_no,
  purchase_token_hash,
  paid_at,
  granted_at
) VALUES (?, ?, ?, ?, NOW(), NOW());

UPDATE payment_orders
SET status = 'fulfilled',
    paid_at = COALESCE(paid_at, NOW()),
    alipay_trade_no = ?,
    raw_notify = ?,
    updated_at = NOW()
WHERE out_trade_no = ?;

COMMIT;
```

这里的 `payment_orders.status = 'fulfilled'` 只表示订单已完成且下载权限已授予。真正的权限依据是 `user_csv_purchases` 里的购买记录和 `granted_at`。

如果支付宝重复通知：

- `payment_orders.out_trade_no` 唯一。
- `user_csv_purchases.out_trade_no` 唯一。
- `user_csv_purchases(user_id, batch_id)` 唯一。

因此重复通知不会重复授予权限，也不会生成重复购买记录。

如果订单已经是 `fulfilled`，回调应视为幂等成功，返回支付宝纯文本 `success`。

### 下载 CSV

```text
GET /api/csv-batches/:batchId/download?userId=xxx&token=xxx
```

下载前校验：

1. `userId` 非空。
2. `token` 非空。
3. `sha256(token)` 能匹配 `user_csv_purchases.purchase_token_hash`。
4. `user_csv_purchases.user_id = userId`。
5. `user_csv_purchases.batch_id = batchId`。
6. `csv_batches.storage_path` 文件存在。

通过后返回：

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="blogs_20260601_20260701.csv"
```

购买凭证建议设计为一次生成、前端保存：

```text
purchaseToken = base64url(randomBytes(32))
purchaseTokenHash = sha256(purchaseToken)
```

后端只保存 hash，不保存明文 token。创建购买记录后，接口返回明文 token 给插件，插件保存到 `chrome.storage.sync` 或 `chrome.storage.local`。

如果担心用户换设备后 token 丢失，可以提供“重新签发下载凭证”接口，但必须先验证用户身份。目前项目只有 `userId`，安全性有限，所以第一版建议直接在订单列表接口里对已购买记录返回下载链接和 token，风险由 `userId` 体系承担。

## 前端改造

购买页从“套餐卡片”改成“CSV 文件列表”：

- 文件名
- 数据日期范围，例如 `2026-06-01 至 2026-07-01`
- 行数
- 生成时间
- 价格
- 状态：可购买 / 已购买
- 操作：购买 / 下载

前端状态：

- `available`：显示购买按钮。
- `pending_payment`：显示继续支付、取消订单。
- `purchased`：显示下载按钮。
- `disabled`：不可购买；如果已购买仍可下载。

下载时携带：

```json
{
  "userId": "user_xxx",
  "batchId": 12,
  "purchaseToken": "..."
}
```

## 幂等和防重复策略

### 防重复导出

依赖：

```sql
UNIQUE KEY uk_csv_batch_items_source_once (blog_run_stat_id)
```

即使定时任务被重复触发，同一条 `blog_run_stats.id` 也只能进入一个 CSV 批次。

### 防重复购买

依赖：

```sql
UNIQUE KEY uk_user_csv_purchases_user_batch (user_id, batch_id)
```

一个 CSV 可卖给多个用户，但同一用户只能购买一次。

### 防重复授权

依赖：

```sql
UNIQUE KEY uk_user_csv_purchases_trade_no (out_trade_no)
UNIQUE KEY uk_user_csv_purchases_token_hash (purchase_token_hash)
```

支付宝重复通知时，事务内发现订单已 `fulfilled` 或购买记录已存在，直接返回成功。

### 防并发下单

沿用当前 `GET_LOCK('payment_order:{userId}', 5)` 的思路。创建订单时对同一用户加锁，避免同时创建多个待支付订单。

## 实施顺序

1. 新增表结构和迁移逻辑。
2. 新增 CSV 导出模块，但先做手动触发接口或脚本验证。
3. 加定时任务和 MySQL 命名锁。
4. 改造 `create-order` 支持 `batchId`。
5. 改造支付宝 `notify`，支付成功后事务内写入 `user_csv_purchases`，授予该 CSV 下载权限，并将订单置为 `fulfilled`。
6. 新增 CSV 列表和下载接口。
7. 改造 `payment.html` / `payment.js`，从套餐选择变成 CSV 文件选择和下载。
8. 加测试：
   - 不足 250 条不生成 CSV。
   - 250 条生成一个 CSV。
   - 同一 `blog_run_stats.id` 不会重复导出。
   - 同一用户不能重复购买同一个 batch。
   - 支付宝重复 notify 不会重复授权。
   - 未购买、token 错误、batch 不匹配时不能下载。

## 待确认

- 下载凭证丢失后是否允许重新签发。
- 是否需要后台管理接口下架某个 CSV。
- CSV 价格是否所有批次固定，还是每个批次可单独定价。
