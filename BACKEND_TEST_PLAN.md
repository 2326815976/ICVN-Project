# 后端测试计划

本文档用于指导当前后端测试建设，目标是覆盖“任务导入人物关系 -> 应用入图 -> 查询追溯”这条主链路。

## 当前优先级

1. API 合同测试：覆盖当前活跃接口。
2. Repository 集成测试：重点覆盖事务一致性与幂等。
3. 少量 Unit：覆盖工具函数与响应封装。
4. 1-2 条 E2E-lite：覆盖任务入图闭环。

## 测试目标

1. 保证 OpenAPI 中保留的接口都可被正确调用。
2. 保证核心写路径在异常场景下不会产生半写入。
3. 保证任务主流程稳定可回归。
4. 保证来源、证据、变更历史这三条追溯链可用。

## 测试范围

- `app/api/**`
- `lib/server/repository.ts`
- `lib/server/utils.ts`
- 数据库对象：任务、节点、边、事件、来源、证据、历史

## 分层策略

1. Unit
2. Integration
3. API Contract
4. E2E-lite

## 集成测试重点

### Tasks

1. `createTask` 成功写入 `tasks`、`task_events`。
2. `createTask` 输入非法时返回 400。
3. `listTasks` 的 `graphId/status/sourceType` 过滤有效。
4. `getTaskDetail` 缺失返回 404。
5. `parseTaskContent` 成功写入或更新 `task_results` 与任务状态。
6. `getTaskResult` 无结果时返回 409。
7. `applyTaskResult`：
   - `validated` 任务可应用
   - 会写入节点、边、来源、证据、变更历史
   - 重复 apply 保持幂等
8. `deleteTask`：
   - 未入图任务可删除
   - `applied` 任务返回 409
9. `listTaskEvents` 返回顺序稳定。

### Graph

1. `createGraphNode/updateGraphNode/deleteGraphNode`
2. `createGraphEdge/updateGraphEdge/deleteGraphEdge`
3. 删除时关联边、来源映射、证据映射清理正确

### Query

1. `getGraphView`
2. `getGraphSubgraph`
3. `queryNodeRelations/queryNodeDetail/queryNodeSources/queryNodeHistory`
4. `queryEdgeDetail`
5. `querySearch/querySubgraph`

### 事务一致性

1. `createTask` 任一步失败整体回滚。
2. `applyTaskResult` 中途失败整体回滚。
3. 并发 apply 同一任务时状态受控。

## API 合同覆盖

### Tasks

1. `POST /api/tasks`
2. `GET /api/tasks`
3. `GET /api/tasks/{taskId}`
4. `DELETE /api/tasks/{taskId}`
5. `GET /api/tasks/{taskId}/result`
6. `POST /api/tasks/{taskId}/apply`
7. `GET /api/tasks/{taskId}/events`

### Graph

8. `POST /api/graph/nodes`
9. `PATCH /api/graph/nodes/{id}`
10. `DELETE /api/graph/nodes/{id}`
11. `POST /api/graph/edges`
12. `PATCH /api/graph/edges/{id}`
13. `DELETE /api/graph/edges/{id}`
14. `GET /api/graph/view`
15. `GET /api/graph/subgraph`

### Query

16. `GET /api/query/nodes/{nodeId}/relations`
17. `GET /api/query/nodes/{nodeId}/detail`
18. `GET /api/query/nodes/{nodeId}/sources`
19. `GET /api/query/nodes/{nodeId}/history`
20. `GET /api/query/edges/{edgeId}`
21. `GET /api/query/search`
22. `POST /api/query/subgraph`

### Task Parse

23. `POST /api/tasks/{taskId}/parse`

## E2E-lite

1. 创建任务。
2. 提交任务解析文本。
3. 查询任务详情和结构化结果。
4. 应用任务结果入图。
5. 查询图视图确认节点和边存在。
6. 查询任务事件确认存在 `applied`。

## 验收门槛

1. 当前活跃接口 100% 覆盖。
2. `createTask` 与 `applyTaskResult` 必须有集成测试。
3. 任务入图主链路必须有 E2E-lite。
4. 失败场景至少覆盖 400/404/409。
