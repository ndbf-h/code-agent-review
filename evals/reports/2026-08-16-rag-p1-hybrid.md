# RAG 检索评测报告（baseline vs hybrid）

- 查询总数: 24
- hybrid 运行模式: 向量分支 ❌ 未配置 EMBEDDING_API_KEY（BM25 单分支），重排 未配置

## 总体对比

| 指标 | baseline（词元打分） | hybrid（BM25+向量+RRF+重排） |
| --- | --- | --- |
| **Recall@5** | 75.0% | **75.0%** |
| MRR | 0.729 | 0.708 |
| 零结果率 | 25.0% | 25.0% |
| 提升幅度 | — | Recall@5 +0.0pp |

## 按查询类型对比（Recall@5）

| 类型 | baseline | hybrid | 查询数 |
| --- | --- | --- | --- |
| exact-english | 100.0% | 100.0% | 5 |
| paraphrase-english | 100.0% | 100.0% | 5 |
| chinese-only | 0.0% | 0.0% | 5 |
| code-snippet | 75.0% | 75.0% | 4 |
| dimension-filtered | 100.0% | 100.0% | 5 |

## hybrid 逐查询明细

| 查询 | 类型 | Recall@5 | MRR | 检索结果 |
| --- | --- | --- | --- | --- |
| rag-e1 | exact-english | 100.0% | 1.00 | security-sql-injection, performance-database-loop, security-xss, performance-complexity |
| rag-e2 | exact-english | 100.0% | 1.00 | security-xss |
| rag-e3 | exact-english | 100.0% | 1.00 | security-secrets |
| rag-e4 | exact-english | 100.0% | 1.00 | performance-database-loop, security-sql-injection, performance-complexity, security-secrets |
| rag-e5 | exact-english | 100.0% | 1.00 | performance-complexity, performance-database-loop, style-maintainability, logic-boundaries |
| rag-p1 | paraphrase-english | 100.0% | 1.00 | security-xss, security-sql-injection |
| rag-p2 | paraphrase-english | 100.0% | 1.00 | performance-database-loop, security-secrets, security-sql-injection |
| rag-p3 | paraphrase-english | 100.0% | 0.50 | security-sql-injection, security-secrets, logic-boundaries |
| rag-p4 | paraphrase-english | 100.0% | 1.00 | logic-boundaries, performance-complexity, performance-database-loop, style-maintainability, security-secrets |
| rag-p5 | paraphrase-english | 100.0% | 1.00 | logic-null-errors, style-maintainability, performance-complexity, performance-database-loop |
| rag-c1 | chinese-only | 0.0% | 0.00 | (空) |
| rag-c2 | chinese-only | 0.0% | 0.00 | (空) |
| rag-c3 | chinese-only | 0.0% | 0.00 | (空) |
| rag-c4 | chinese-only | 0.0% | 0.00 | (空) |
| rag-c5 | chinese-only | 0.0% | 0.00 | (空) |
| rag-s1 | code-snippet | 100.0% | 0.50 | security-secrets, security-sql-injection |
| rag-s2 | code-snippet | 0.0% | 0.00 | (空) |
| rag-s3 | code-snippet | 100.0% | 1.00 | performance-database-loop, logic-null-errors |
| rag-s4 | code-snippet | 100.0% | 1.00 | logic-null-errors |
| rag-d1 | dimension-filtered | 100.0% | 1.00 | logic-null-errors |
| rag-d2 | dimension-filtered | 100.0% | 1.00 | performance-database-loop |
| rag-d3 | dimension-filtered | 100.0% | 1.00 | security-sql-injection, security-xss |
| rag-d4 | dimension-filtered | 100.0% | 1.00 | style-maintainability |
| rag-d5 | dimension-filtered | 100.0% | 1.00 | performance-complexity, performance-database-loop |