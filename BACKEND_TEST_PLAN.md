# 后端完整测试流程（不含代码实现）

本文档用于指导当前项目后端测试建设，目标是：
- 覆盖现有后端能力（路由层、仓储层、事务层、核心流程）
- 对齐 `openapi.yaml` 合同
- 明确每一类测试该测什么、怎么测、何时通过

## 当前阶段优先级（先做这 4 类）

1. API 合同测试（OpenAPI 29 个接口全覆盖）。
2. Repository 集成测试（重点覆盖事务、幂等、回滚）。
3. 少量 Unit（工具函数与参数/响应封装）。
4. 1-2 条后端 E2E 主流程（任务入图闭环、版本回滚闭环）。

## 1. 测试目标与范围

### 1.1 目标
1. 保证 OpenAPI 中定义的接口均可被正确调用。
2. 保证核心数据写路径在异常场景下具备事务一致性。
3. 保证任务主链路（创建任务 -> 获取结果 -> 应用结果 -> 图谱查询）稳定可回归。
4. 保证 AI 预留接口在 AI 部门未接入前，行为可预测（统一 501）。

### 1.2 测试范围
- `app/api/**`：所有路由处理器
- `lib/server/repository.ts`：核心业务与数据库交互
- `lib/server/utils.ts` / `lib/server/api.ts`：工具与响应封装
- 数据库对象：任务、图节点、图边、版本、事件、来源、证据、关联表

### 1.3 不在本阶段范围
- 前端 UI 交互测试
- AI 模型正确性测试（由 AI 团队负责）
- 压测/容量测试（可作为后续阶段）

## 2. 测试分层策略

必须同时建设 4 层：
1. 单元测试（Unit）
2. 集成测试（Integration）
3. 接口合同测试（API Contract）
4. 后端端到端流程测试（E2E-lite）

建议比例：
- Unit 25%
- Integration 40%
- API Contract 25%
- E2E-lite 10%

## 3. 测试环境与数据策略

### 3.1 环境
1. 独立测试数据库（与开发库隔离）。
2. 测试执行前执行初始化 SQL。
3. 每个测试文件可独立准备 fixture 数据。
4. 测试结束清理数据（或使用事务回滚隔离）。

### 3.2 数据策略
1. 基础图 `graphId`：固定测试图 + 随机后缀，防止并发冲突。
2. 关键实体：预置最小节点、边、版本、任务。
3. 对于“资源不存在”用例，使用明确不存在 ID。
4. 时间相关断言使用“格式与存在性”优先，避免脆弱时间比较。

### 3.3 执行顺序
1. Unit
2. Integration
3. API Contract
4. E2E-lite

CI 中若前一层失败，后续层可直接跳过。

## 4. 单元测试清单（Unit）

## 4.1 `lib/server/api.ts`
1. `createMeta`：返回 `requestId` 与 `timestamp`，字段存在且类型正确。
2. `assertNonEmptyString`：正常值通过；空字符串/非字符串抛 `ApiError(400)`。
3. `parseInteger`：
- 空值返回 fallback
- 非数字返回 fallback
- 低于 min 返回 min
- 高于 max 返回 max
- 正常整数返回自身
4. `readOptionalJsonBody`：
- `content-length=0` 返回 fallback
- 非 `application/json` 返回 fallback
5. `errorResponse`：
- `ApiError` 映射为对应 status/code/message
- 非 `ApiError` 映射 500

## 4.2 `lib/server/utils.ts`
1. `truncateText`：短文本不截断，长文本按长度截断并补 `...`。
2. `toJsonString/fromJsonValue`：对象序列化反序列化、非法 JSON fallback。
3. `coerceRecord/coerceStringArray`：容错类型转换。
4. `paginate`：分页边界（首页、末页、空列表）。
5. `extractEntityCandidates`：英文实体/中文词提取、停用词过滤、上限限制。
6. `buildSyntheticParseResult`：
- 返回结构满足 `AiParseResult`
- nodes/edges/events 字段完整
- meta 中 provider/model/sourceType 存在

## 5. 集成测试清单（Integration，Repository + DB）

## 5.1 tasks 相关
1. `createTask`：
- 最小合法输入成功写入 `tasks/task_results/task_events`
- 有 files 时写入 `task_files`
2. `createTask` 输入非法（无 content 且无 files）返回 400。
3. `listTasks`：
- graphId 过滤有效
- status/sourceType 过滤有效
- 分页字段正确
4. `getTaskDetail`：存在返回，缺失抛 404。
5. `getTaskResult`：
- 有 normalized_result 返回成功
- 无结果返回 409
6. `applyTaskResult`：
- validated 任务可应用，写入 nodes/edges/history/source/evidence
- applied 任务重复应用保持幂等
- 非 validated/applied 返回 409
- 可选生成版本（`createSnapshot=true/false`）行为正确
7. `listTaskEvents`：按 seq 与 createdAt 有序返回。

## 5.2 graph 节点与边
1. `createGraphNode`：成功写入并可查询。
2. `updateGraphNode`：更新成功；不存在节点返回 404。
3. `deleteGraphNode`：
- 删除节点成功
- 关联边、证据、关联关系清理正确
4. `createGraphEdge`：
- 成功写入
- source/target 缺失时返回业务错误
5. `updateGraphEdge`：存在更新成功，不存在返回 404。
6. `deleteGraphEdge`：删除成功并清理关联，不存在返回 404。

## 5.3 查询与版本
1. `getGraphView`：返回节点、边、当前版本（若有）。
2. `getGraphSubgraph`：按 depth 返回合理子图。
3. `queryNodeRelations/queryNodeDetail/queryNodeSources/queryNodeHistory`：
- 正常查询
- 节点不存在返回 404
4. `queryEdgeDetail`：存在返回详情，不存在返回 404。
5. `querySearch/queryPath/querySubgraph`：参数有效时返回结果。
6. `createVersion`：生成快照与版本记录成功。
7. `getVersionDetail`：存在返回详情，不存在返回 404。
8. `rollbackVersion`：
- 回滚后图数据与目标版本快照一致
- 生成新版本记录

## 5.4 事务一致性专项
1. `createTask` 中任一子步骤失败应整体回滚。
2. `applyTaskResult` 中写入中途失败应回滚，不产生半写入。
3. `rollbackVersion` 失败时不破坏当前图状态。
4. 并发 apply 同一任务，不应生成冲突状态（幂等或受控失败）。

## 6. 接口合同测试清单（API Contract）

## 6.1 通用合同
1. 每个接口响应都符合 envelope：
- 成功：`success=true,data,meta`
- 失败：`success=false,error,meta`
2. `meta.requestId`、`meta.timestamp` 必有。
3. 参数缺失返回 400，错误码可预期。
4. 方法不匹配返回 405。

## 6.2 按 OpenAPI 路径逐条覆盖

### Tasks
1. `POST /api/tasks`
2. `GET /api/tasks`
3. `GET /api/tasks/{taskId}`
4. `GET /api/tasks/{taskId}/result`
5. `POST /api/tasks/{taskId}/apply`
6. `GET /api/tasks/{taskId}/events`

### Graph
7. `POST /api/graph/nodes`
8. `PATCH /api/graph/nodes/{id}`
9. `DELETE /api/graph/nodes/{id}`
10. `POST /api/graph/edges`
11. `PATCH /api/graph/edges/{id}`
12. `DELETE /api/graph/edges/{id}`
13. `GET /api/graph/view`
14. `GET /api/graph/subgraph`

### Query
15. `GET /api/query/nodes/{nodeId}/relations`
16. `GET /api/query/nodes/{nodeId}/detail`
17. `GET /api/query/nodes/{nodeId}/sources`
18. `GET /api/query/nodes/{nodeId}/history`
19. `GET /api/query/edges/{edgeId}`
20. `GET /api/query/search`
21. `GET /api/query/path`
22. `POST /api/query/subgraph`

### Versions
23. `POST /api/versions`
24. `GET /api/versions`
25. `GET /api/versions/{versionId}`
26. `POST /api/versions/{versionId}/rollback`

### AI（占位接口）
27. `POST /api/ai/parse` -> 断言 501
28. `GET /api/ai/jobs/{jobId}` -> 断言 501
29. `POST /api/ai/jobs/{jobId}/apply` -> 断言 501

## 7. 后端端到端流程测试（E2E-lite）

## 7.1 主流程：任务入图闭环
1. 创建任务 `POST /tasks`
2. 查询任务列表/详情确认状态
3. 获取任务结果 `GET /tasks/{id}/result`
4. 应用结果 `POST /tasks/{id}/apply`
5. 查询图视图 `GET /graph/view`，断言新增节点/边存在
6. 查询事件 `GET /tasks/{id}/events`，断言有 `applied`

## 7.2 版本回滚闭环
1. 基于图数据创建版本 A
2. 修改图数据并创建版本 B
3. 回滚到版本 A
4. 查询图视图，断言与 A 一致

## 8. 异常与边界测试清单

1. 非法 JSON 请求体 -> 400 `BAD_REQUEST`。
2. 缺失必填 query/path/body 字段 -> 400。
3. 不存在实体 ID -> 404。
4. 状态冲突（如任务未 ready 就 apply）-> 409。
5. 空列表、空结果、极端分页参数。
6. 超长文本/特殊字符输入不崩溃。

## 9. 执行与验收标准

## 9.1 每日执行建议
1. 开发阶段：执行 Unit + 受影响 Integration。
2. 提交前：执行全部 Unit + Integration + API Contract。
3. 合并前：执行全量（含 E2E-lite）。

## 9.2 验收门槛（建议）
1. OpenAPI 覆盖率：100%（29/29 路径方法）。
2. 关键写路径（createTask/applyTaskResult/rollbackVersion）必须有集成测试。
3. 关键主链路（任务入图）必须有 E2E-lite 用例。
4. 失败场景（400/404/409/501）均有断言。

## 10. 推荐落地顺序（一次做完这批）

1. 第 1 天：API Contract 全覆盖（29 个接口）。
2. 第 2 天：tasks + graph 的 Integration。
3. 第 3 天：query + versions 的 Integration。
4. 第 4 天：事务一致性专项 + E2E-lite。
5. 第 5 天：补齐 Unit 边界用例、稳定 CI。

---

如需继续下一步，可基于本文件直接拆成测试任务看板：
- P0（必须）：API 合同 + 事务一致性 + 主链路 E2E-lite
- P1（建议）：其余 Integration
- P2（补强）：更细边界与健壮性
