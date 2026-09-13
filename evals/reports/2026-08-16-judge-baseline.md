# LLM-as-Judge 评测报告

- judge 模型: (默认，同生产模型)
- 评分样本: 48（失败 0）
- **平均 coverage: 7.4/10**
- 平均 precision: 6.3/10
- 平均 actionability: 6.9/10
- 与确定性匹配的分歧样本: 11 个（judge 高分但匹配判未覆盖，需人工复核）

| 样本 | 层级 | 确定性匹配 | coverage | precision | actionability | 分歧 |
| --- | --- | --- | --- | --- | --- | --- |
| e01 | easy | 0/1 | 10 | 7 | 9 | ⚠️ |
| e02 | easy | 1/1 | 10 | 5 | 7 |  |
| e03 | easy | 1/1 | 4 | 5 | 5 |  |
| e04 | easy | 1/1 | 10 | 8 | 9 |  |
| e05 | easy | 0/1 | 10 | 5 | 7 | ⚠️ |
| e06 | easy | 0/1 | 5 | 6 | 7 |  |
| e07 | easy | 0/1 | 1 | 3 | 2 |  |
| e08 | easy | 1/1 | 10 | 7 | 8 |  |
| e09 | easy | 1/1 | 10 | 9 | 8 |  |
| e10 | easy | 1/1 | 7 | 5 | 6 |  |
| e11 | easy | 0/1 | 5 | 6 | 7 |  |
| e12 | easy | 1/1 | 1 | 5 | 6 |  |
| e13 | easy | 1/1 | 10 | 6 | 7 |  |
| e14 | easy | 1/1 | 4 | 6 | 7 |  |
| e15 | easy | 0/1 | 10 | 8 | 8 | ⚠️ |
| e16 | easy | 1/1 | 10 | 6 | 6 |  |
| e17 | easy | 0/1 | 10 | 7 | 8 | ⚠️ |
| e18 | easy | 0/1 | 6 | 7 | 6 |  |
| e19 | easy | 0/1 | 6 | 6 | 5 |  |
| e20 | easy | 1/1 | 10 | 8 | 7 |  |
| t01 | tricky | 1/2 | 5 | 5 | 8 |  |
| t02 | tricky | 1/1 | 3 | 6 | 7 |  |
| t03 | tricky | 0/1 | 10 | 8 | 8 | ⚠️ |
| t04 | tricky | 0/2 | 10 | 6 | 7 | ⚠️ |
| t05 | tricky | 1/1 | 3 | 5 | 5 |  |
| t06 | tricky | 1/1 | 10 | 6 | 7 |  |
| t07 | tricky | 1/1 | 10 | 7 | 3 |  |
| t08 | tricky | 1/1 | 10 | 7 | 5 |  |
| t09 | tricky | 0/1 | 5 | 4 | 6 |  |
| t10 | tricky | 1/1 | 10 | 6 | 7 |  |
| t11 | tricky | 0/2 | 5 | 6 | 8 |  |
| t12 | tricky | 0/1 | 10 | 7 | 8 | ⚠️ |
| t13 | tricky | 1/1 | 10 | 5 | 7 |  |
| t14 | tricky | 1/1 | 8 | 8 | 9 |  |
| t15 | tricky | 1/1 | 2 | 7 | 6 |  |
| t16 | tricky | 1/2 | 5 | 6 | 7 |  |
| a01 | adversarial | 0/1 | 10 | 6 | 8 | ⚠️ |
| a02 | adversarial | 1/1 | 3 | 7 | 6 |  |
| a03 | adversarial | 1/1 | 10 | 7 | 6 |  |
| a04 | adversarial | 0/1 | 10 | 6 | 8 | ⚠️ |
| a05 | adversarial | 0/1 | 1 | 6 | 7 |  |
| a06 | adversarial | 1/1 | 10 | 6 | 7 |  |
| a07 | adversarial | 1/1 | 3 | 5 | 4 |  |
| a08 | adversarial | 0/1 | 3 | 7 | 8 |  |
| a09 | adversarial | 0/1 | 10 | 8 | 9 | ⚠️ |
| a10 | adversarial | 2/2 | 10 | 6 | 7 |  |
| a11 | adversarial | 1/2 | 10 | 6 | 8 |  |
| a12 | adversarial | 0/1 | 10 | 10 | 10 | ⚠️ |