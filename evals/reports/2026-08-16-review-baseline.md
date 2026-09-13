# 代码审查质量评测报告

- 样本总数: 48（成功 48 / 失败 0）
- **期望问题召回率: 53.7%**
- 规则引擎降级率（fallback）: 0.0%
- 额外发现（不计误报）: 462 条
- 平均评分: 70.9，平均耗时: 31.1s

## 分层召回率

| 层级 | 样本数 | 召回率 |
| --- | --- | --- |
| easy | 20 | 55.0% |
| tricky | 16 | 55.0% |
| adversarial | 12 | 50.0% |

## 分维度召回率

| 维度 | 期望条数 | 命中 | 召回率 |
| --- | --- | --- | --- |
| security | 21 | 8 | 38.1% |
| performance | 8 | 6 | 75.0% |
| style | 6 | 6 | 100.0% |
| logic | 19 | 9 | 47.4% |

## 漏检清单（期望发现但未发现）

| 样本 | 层级 | 维度 | 期望问题 |
| --- | --- | --- | --- |
| e01 | easy | security | SQL 注入 |
| e05 | easy | security | SQL 注入 |
| e06 | easy | security | 硬编码密钥 |
| e07 | easy | security | SQL 注入 |
| e11 | easy | performance | 内存拷贝 |
| e15 | easy | logic | 索引安全 |
| e17 | easy | logic | 空异常处理 |
| e18 | easy | logic | 空值安全 |
| e19 | easy | logic | 未处理 Promise |
| t01 | tricky | logic | 竞态 |
| t03 | tricky | logic | 未处理 Promise |
| t04 | tricky | logic | 吞 |
| t04 | tricky | logic | 异常 |
| t09 | tricky | performance | N+1 查询 |
| t11 | tricky | security | 硬编码密钥 |
| t11 | tricky | security | 日志 |
| t12 | tricky | security | XSS 漏洞 |
| t16 | tricky | security | SQL 注入 |
| a01 | adversarial | security | SQL 注入 |
| a04 | adversarial | security | XSS 漏洞 |
| a05 | adversarial | security | SQL 注入 |
| a08 | adversarial | logic | 未处理 Promise |
| a09 | adversarial | security | 路径遍历 |
| a11 | adversarial | security | 硬编码密钥 |
| a12 | adversarial | logic | 索引安全 |