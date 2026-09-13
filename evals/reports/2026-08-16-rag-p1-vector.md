# RAG 检索评测报告（baseline vs hybrid）

- 查询总数: 24
- hybrid 运行模式: 向量分支 ✅ 开启，重排 ✅ 开启

## 总体对比

| 指标 | baseline（词元打分） | hybrid（BM25+向量+RRF+重排） |
| --- | --- | --- |
| **Recall@5** | 75.0% | **100.0%** |
| MRR | 0.729 | 0.927 |
| 零结果率 | 25.0% | 0.0% |
| 提升幅度 | — | Recall@5 +25.0pp |

## 按查询类型对比（Recall@5）

| 类型 | baseline | hybrid | 查询数 |
| --- | --- | --- | --- |
| exact-english | 100.0% | 100.0% | 5 |
| paraphrase-english | 100.0% | 100.0% | 5 |
| chinese-only | 0.0% | 100.0% | 5 |
| code-snippet | 75.0% | 100.0% | 4 |
| dimension-filtered | 100.0% | 100.0% | 5 |

## hybrid 逐查询明细

| 查询 | 类型 | Recall@5 | MRR | 检索结果 |
| --- | --- | --- | --- | --- |
| rag-e1 | exact-english | 100.0% | 1.00 | security-sql-injection, logic-boundaries, performance-complexity, performance-database-loop, style-maintainability |
| rag-e2 | exact-english | 100.0% | 1.00 | security-xss, logic-null-errors, logic-boundaries, style-maintainability, performance-database-loop |
| rag-e3 | exact-english | 100.0% | 1.00 | security-secrets, security-sql-injection, style-maintainability, security-xss, performance-complexity |
| rag-e4 | exact-english | 100.0% | 1.00 | performance-database-loop, security-sql-injection, performance-complexity, logic-boundaries, security-secrets |
| rag-e5 | exact-english | 100.0% | 1.00 | performance-complexity, performance-database-loop, logic-null-errors, style-maintainability, logic-boundaries |
| rag-p1 | paraphrase-english | 100.0% | 1.00 | security-xss, logic-boundaries, style-maintainability, performance-complexity, logic-null-errors |
| rag-p2 | paraphrase-english | 100.0% | 1.00 | performance-database-loop, performance-complexity, security-sql-injection, style-maintainability, logic-boundaries |
| rag-p3 | paraphrase-english | 100.0% | 0.50 | security-sql-injection, security-secrets, performance-database-loop, security-xss, logic-null-errors |
| rag-p4 | paraphrase-english | 100.0% | 1.00 | logic-boundaries, performance-database-loop, performance-complexity, security-sql-injection, logic-null-errors |
| rag-p5 | paraphrase-english | 100.0% | 1.00 | logic-null-errors, performance-database-loop, performance-complexity, security-sql-injection, style-maintainability |
| rag-c1 | chinese-only | 100.0% | 1.00 | security-sql-injection, performance-database-loop, style-maintainability, logic-boundaries, security-secrets |
| rag-c2 | chinese-only | 100.0% | 1.00 | performance-database-loop, logic-boundaries, performance-complexity, style-maintainability, security-sql-injection |
| rag-c3 | chinese-only | 100.0% | 1.00 | security-secrets, security-sql-injection, style-maintainability, security-xss, logic-null-errors |
| rag-c4 | chinese-only | 100.0% | 1.00 | logic-null-errors, logic-boundaries, security-sql-injection, performance-database-loop, style-maintainability |
| rag-c5 | chinese-only | 100.0% | 1.00 | logic-boundaries, performance-database-loop, security-sql-injection, logic-null-errors, performance-complexity |
| rag-s1 | code-snippet | 100.0% | 0.50 | performance-database-loop, security-sql-injection, logic-boundaries, performance-complexity, security-secrets |
| rag-s2 | code-snippet | 100.0% | 1.00 | security-xss, logic-null-errors, performance-complexity, style-maintainability, logic-boundaries |
| rag-s3 | code-snippet | 100.0% | 1.00 | performance-database-loop, performance-complexity, security-sql-injection, security-secrets, style-maintainability |
| rag-s4 | code-snippet | 100.0% | 0.25 | style-maintainability, logic-boundaries, performance-database-loop, logic-null-errors, performance-complexity |
| rag-d1 | dimension-filtered | 100.0% | 1.00 | logic-null-errors, logic-boundaries |
| rag-d2 | dimension-filtered | 100.0% | 1.00 | performance-database-loop, performance-complexity |
| rag-d3 | dimension-filtered | 100.0% | 1.00 | security-sql-injection, security-xss, security-secrets |
| rag-d4 | dimension-filtered | 100.0% | 1.00 | style-maintainability |
| rag-d5 | dimension-filtered | 100.0% | 1.00 | performance-complexity, performance-database-loop |