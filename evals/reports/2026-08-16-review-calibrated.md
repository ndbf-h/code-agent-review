# 代码审查质量评测报告

- 样本总数: 48（成功 48 / 失败 0）
- **期望问题召回率: 81.5%**
- 规则引擎降级率（fallback）: 0.0%
- 额外发现（不计误报）: 447 条
- 平均评分: 70.9，平均耗时: 31.1s

## 分层召回率

| 层级 | 样本数 | 召回率 |
| --- | --- | --- |
| easy | 20 | 80.0% |
| tricky | 16 | 80.0% |
| adversarial | 12 | 85.7% |

## 分维度召回率

| 维度 | 期望条数 | 命中 | 召回率 |
| --- | --- | --- | --- |
| security | 21 | 19 | 90.5% |
| performance | 8 | 7 | 87.5% |
| style | 6 | 6 | 100.0% |
| logic | 19 | 12 | 63.2% |

## 漏检清单（期望发现但未发现）

| 样本 | 层级 | 维度 | 期望问题 |
| --- | --- | --- | --- |
| e11 | easy | performance | 内存拷贝 |
| e15 | easy | logic | 索引安全 |
| e18 | easy | logic | 空值安全 |
| e19 | easy | logic | 未处理 Promise |
| t01 | tricky | logic | 竞态 |
| t03 | tricky | logic | 未处理 Promise |
| t11 | tricky | security | 硬编码密钥 |
| t11 | tricky | security | 日志 |
| a08 | adversarial | logic | 未处理 Promise |
| a12 | adversarial | logic | 索引安全 |