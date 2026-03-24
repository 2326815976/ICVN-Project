# 数据库设计说明

本文档以 [docs/openapi.yaml](/Users/8086k/project/nodeproject/docs/openapi.yaml) 为准，描述后端数据库如何支撑当前 API 契约。

## 1. 存储边界

- Neo4j：保存最终入图后的节点与关系，对应 API 中的 `GraphNode`、`EventNode`、`GraphEdge`
- PostgreSQL：保存图谱作用域、任务、版本、快照、来源、证据、AI 作业与变更历史等结构化数据
- 命名规范：数据库字段使用 `snake_case`，API 字段使用 `camelCase`

### 1.1 API 对象与数据库映射

- `GraphView`：由 Neo4j 当前图结构 + PostgreSQL 当前版本摘要拼装返回
- `AiParseResult`：落在 `task_results.normalized_result`，原始模型输出可落在 `task_results.raw_result`
- `GraphVersion.snapshotId`：来自 `graph_versions.snapshot_id`
- `Task.currentVersion`：来自 `tasks.applied_version_id`
- `TaskEvent.type`：映射数据库字段 `task_events.event_type`

## 2. 核心表

### 2.1 graphs

图谱主表，对应 API 中所有 `graphId` 的作用域。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | VARCHAR(64) | 图谱 ID，主键 |
| name | VARCHAR(255) | 图谱名称 |
| description | TEXT | 图谱描述 |
| status | VARCHAR(32) | 状态：`active` / `archived` |
| created_by | UUID | 创建人 |
| created_at | TIMESTAMPTZ | 创建时间 |

### 2.2 graph_versions

图谱版本元信息，对应 API `GraphVersion`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| version_no | INTEGER | 版本号，同一图谱内递增 |
| name | VARCHAR(255) | 版本名称 |
| description | TEXT | 版本说明 |
| trigger | VARCHAR(32) | 触发方式：`manual` / `auto` / `rollback` / `ai-import` |
| snapshot_id | UUID | 快照 ID，FK -> `graph_snapshots.id` |
| created_by | UUID | 创建人 |
| created_at | TIMESTAMPTZ | 创建时间 |

约束建议：

- 唯一索引：`(graph_id, version_no)`
- 唯一索引：`snapshot_id`

### 2.3 graph_snapshots

版本快照表，保存图谱某一时刻的完整快照。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| snapshot_json | JSONB | 图完整快照，建议存 `GraphView` 风格结构 |
| metadata | JSONB | 快照元数据，如统计信息、回滚来源、备注 |
| created_at | TIMESTAMPTZ | 创建时间 |

说明：

- 版本与快照采用 `graph_versions.snapshot_id -> graph_snapshots.id` 关联
- `VersionDetailResponse.snapshotSummary` 可优先从 `metadata` 冗余统计信息中读取

### 2.4 tasks

任务主表，对应 API `Task`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| source_type | VARCHAR(32) | 来源类型：`document` / `text` / `news` / `social` / `story` / `custom` |
| title | VARCHAR(255) | 任务标题 |
| input_text | TEXT | 原始输入文本；文件类任务可为空 |
| content_preview | TEXT | 原始内容摘要，对应 API `contentPreview` |
| status | VARCHAR(32) | 状态：`uploaded` / `queued` / `processing` / `validated` / `applied` / `failed` / `canceled` |
| error_message | TEXT | 错误信息 |
| idempotency_key | VARCHAR(128) | 幂等键，内部字段，建议唯一 |
| ai_job_id | UUID | 当前关联 AI 作业，FK -> `ai_jobs.id`，可为空 |
| applied_version_id | UUID | 任务结果正式入图后关联的版本 ID，FK -> `graph_versions.id`，可为空 |
| created_by | UUID | 创建人 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

说明：

- API `Task.currentVersion` 由 `applied_version_id` 关联 `graph_versions` 后返回
- API `GET /tasks/{taskId}/result` 从 `task_results` 读取结果，不直接从 `tasks` 表返回

### 2.5 task_files

任务关联文件，对应 API `TaskFile` / `TaskFileInput`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| task_id | UUID | 任务 ID，FK -> `tasks.id` |
| file_name | VARCHAR(255) | 文件名，对应 `fileName` |
| mime_type | VARCHAR(128) | MIME 类型，对应 `mimeType` |
| file_size | BIGINT | 文件大小，对应 `size` |
| storage_key | TEXT | 存储路径，对应 `storageKey` |
| created_at | TIMESTAMPTZ | 创建时间 |

### 2.6 task_results

任务结构化结果表，对应 API `TaskResultResponse.result`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| task_id | UUID | 任务 ID，唯一，FK -> `tasks.id` |
| raw_result | JSONB | 原始模型输出 |
| normalized_result | JSONB | 标准化结果，建议直接存 `AiParseResult` |
| node_count | INTEGER | 节点数 |
| edge_count | INTEGER | 边数 |
| event_count | INTEGER | 事件数 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

说明：

- `Task.summary` 可由 `node_count`、`edge_count`、`event_count` 组装
- `normalized_result` 是任务预览与最终入图前校验的主数据源

### 2.7 task_events

任务事件流，对应 API `TaskEvent`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| task_id | UUID | 任务 ID，FK -> `tasks.id` |
| seq | INTEGER | 事件序号，内部排序字段 |
| event_type | VARCHAR(64) | 事件类型，对应 API `type` |
| message | TEXT | 事件描述 |
| payload | JSONB | 事件附加数据 |
| created_at | TIMESTAMPTZ | 创建时间 |

约束建议：

- 唯一索引：`(task_id, seq)`

### 2.8 ai_jobs

AI 作业表，对应 API `AiJob`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| task_id | UUID | 关联任务 ID，FK -> `tasks.id`，可为空 |
| source_type | VARCHAR(32) | 解析来源类型：`news` / `social` / `story` / `custom` |
| input_text | TEXT | 提交给 AI 的原始文本 |
| status | VARCHAR(32) | 状态：`pending` / `processing` / `validated` / `applied` / `failed` |
| result_json | JSONB | AI 结构化结果，建议存 `AiParseResult` |
| error_message | TEXT | 失败信息 |
| provider | VARCHAR(128) | AI 服务提供方 |
| model | VARCHAR(128) | 模型标识 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

说明：

- `/ai/jobs/{jobId}/apply` 的“关联 AI 结果到任务上下文”可以更新 `tasks.ai_job_id`，并把结果同步写入 `task_results`

### 2.9 source_records

来源记录表，对应 API `SourceRecord`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| source_type | VARCHAR(32) | 来源类型：`manual` / `task` / `import` / `ai` |
| source_ref_id | VARCHAR(128) | 外部引用 ID，例如 `taskId` |
| title | VARCHAR(255) | 来源标题 |
| content | TEXT | 原始内容、备注或摘要 |
| created_by | UUID | 创建人 |
| created_at | TIMESTAMPTZ | 创建时间 |

### 2.10 entity_source_links

实体与来源的关联表，用于支撑节点/边来源查询。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| entity_type | VARCHAR(16) | 实体类型：`node` / `edge` |
| entity_id | VARCHAR(64) | 节点或边 ID |
| source_record_id | UUID | 来源记录 ID，FK -> `source_records.id` |
| created_at | TIMESTAMPTZ | 创建时间 |

说明：

- 对应 `/query/nodes/{nodeId}/sources` 和 `/query/edges/{edgeId}`
- 删除节点或边时，应同步删除或失效对应映射

### 2.11 evidence_records

证据表，对应 API `EvidenceRecord`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| source_record_id | UUID | 来源记录 ID，FK -> `source_records.id` |
| subject_node_id | VARCHAR(64) | 主节点 ID |
| target_node_id | VARCHAR(64) | 目标节点 ID，可为空 |
| edge_id | VARCHAR(64) | 关系 ID，可为空 |
| relation | VARCHAR(128) | 关系语义，可为空 |
| excerpt | TEXT | 证据文本 |
| speaker | VARCHAR(255) | 说话人，可为空 |
| page_no | INTEGER | 页码，可为空 |
| created_at | TIMESTAMPTZ | 创建时间 |

可选扩展字段：

- `confidence FLOAT`
- `metadata JSONB`

### 2.12 graph_change_history

节点或关系的变更历史，对应 API `ChangeHistoryItem`。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 主键 |
| graph_id | VARCHAR(64) | 图谱 ID，FK -> `graphs.id` |
| entity_type | VARCHAR(16) | 实体类型：`node` / `edge` |
| entity_id | VARCHAR(64) | 实体 ID |
| action | VARCHAR(16) | 操作：`create` / `update` / `delete` |
| field_name | VARCHAR(128) | 变更字段名，对应 API `field` |
| old_value | JSONB | 旧值 |
| new_value | JSONB | 新值 |
| operator_id | UUID | 操作人 |
| source_record_id | UUID | 关联来源记录，可为空 |
| created_at | TIMESTAMPTZ | 创建时间 |

说明：

- API 返回时将 `field_name` 映射为 `field`

## 3. Neo4j 侧固定设计

PostgreSQL 已经为图数据库留出了位置，但要真正可落地，还需要把 Neo4j 侧的主键与存储边界写死。

### 3.1 节点主键规则

- 每个节点都必须有业务主键 `id`
- 每个节点都必须带 `graphId`
- Neo4j 中节点唯一标识按 `(graphId, id)` 识别
- `type` 决定节点标签，例如 `Person`、`Company`、`Organization`、`Place`、`Event`

建议保留的节点属性：

- `id`
- `graphId`
- `type`
- `label`
- `createdAt`
- `updatedAt`
- 事件节点额外保留：`occurredAt`、`periodStart`、`periodEnd`

说明：

- `position` 不建议作为 Neo4j 核心属性
- 任意大对象或原始 JSON 不建议直接堆入 Neo4j，统一保留在 PostgreSQL 的 `task_results` 或 `graph_snapshots`

### 3.2 关系主键规则

- 每条关系都必须有业务主键 `id`
- 每条关系都必须带 `graphId`
- 关系唯一标识按 `(graphId, id)` 识别
- 关系语义由属性 `relation` 表达，不强依赖 Neo4j relationship type 承载业务语义

建议保留的关系属性：

- `id`
- `graphId`
- `relation`
- `label`
- `start`
- `end`
- `weight`
- `createdAt`
- `updatedAt`

推荐做法：

- Neo4j relationship type 固定为通用类型，例如 `RELATES_TO`
- 真实业务关系值统一存在属性 `relation`

这样做的好处：

- 关系类型不用频繁扩展数据库 schema
- 更贴合当前 OpenAPI 的开放字符串设计
- 更容易做统一查询、版本回滚和批量写入

## 4. graph_snapshots 的固定格式

`graph_snapshots.snapshot_json` 不要只写“完整快照”这类模糊描述，建议固定成可直接回滚的结构。

推荐结构：

```json
{
  "graphId": "default",
  "nodes": [
    {
      "id": "person_1",
      "graphId": "default",
      "type": "person",
      "label": "Alice",
      "properties": {
        "aliases": ["A"]
      },
      "occurredAt": null,
      "periodStart": null,
      "periodEnd": null,
      "placeId": null,
      "participants": [],
      "createdAt": "2026-03-24T10:00:00.000Z",
      "updatedAt": "2026-03-24T10:00:00.000Z"
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "graphId": "default",
      "sourceId": "person_1",
      "targetId": "company_1",
      "relation": "founder_of",
      "label": "创始人",
      "start": "2020-01-01",
      "end": null,
      "weight": 0.95,
      "properties": {},
      "createdAt": "2026-03-24T10:00:00.000Z",
      "updatedAt": "2026-03-24T10:00:00.000Z"
    }
  ]
}
```

固定规则：

- `nodes` 结构直接对齐 API `GraphNode` / `EventNode`
- `edges` 结构直接对齐 API `GraphEdge`
- 不在快照里重复嵌入 `version`
- 版本元信息保留在 `graph_versions`
- 快照统计信息写入 `graph_snapshots.metadata`

`metadata` 建议至少包含：

- `nodeCount`
- `edgeCount`
- `capturedAt`
- `sourceTaskId`
- `rollbackFromVersionId`

## 5. `/tasks/{taskId}/apply` 的入图顺序

任务结果应用入图时，建议统一走下面这套顺序，避免 PostgreSQL 和 Neo4j 状态打架。

### 5.1 写入顺序

1. 读取 `tasks` 和 `task_results`，确认任务状态为 `validated`
2. 从 `task_results.normalized_result` 取出标准化的 `nodes` / `edges` / `events`
3. 在 Neo4j 中按 `(graphId, id)` 执行 upsert，完成节点和关系写入
4. 从 Neo4j 读取当前图的完整视图，生成快照 JSON
5. 写入 `graph_snapshots`
6. 写入 `graph_versions`
7. 回写 `tasks.applied_version_id`
8. 更新 `tasks.status = applied`
9. 追加一条 `task_events`，记录“结果已应用”

### 5.2 失败处理规则

- 如果写 Neo4j 失败，PostgreSQL 不应创建新版本
- 如果 Neo4j 成功但 PostgreSQL 写版本失败，需要立刻告警并人工补偿
- 同一个 `taskId` 再次调用 apply 时，应先检查 `tasks.status` 是否已经是 `applied`
- 如果已经 `applied`，直接返回当前 `applied_version_id`，避免重复入图

### 5.3 为什么这样设计

- API 的“正式入图”是以 Neo4j 成功为准
- 版本快照必须描述“已经入图后的状态”
- `Task.currentVersion` 必须能稳定指向本次真正应用成功后的版本

## 6. 删除与合并策略

只要节点和关系在 Neo4j 是主存储，删除和合并策略就必须提前定好，否则 PostgreSQL 很容易留下脏引用。

### 6.1 删除节点

删除节点时，建议按下面顺序执行：

1. 在 Neo4j 删除该节点以及与之关联的关系
2. 删除或失效 `entity_source_links` 中该节点相关映射
3. 删除或失效 `evidence_records` 中 `subject_node_id`、`target_node_id`、`edge_id` 命中的记录
4. 写入 `graph_change_history`
5. 视需要生成新快照与新版本

说明：

- 如果证据需要审计留痕，可以采用“逻辑失效”而不是物理删除
- 若采用逻辑失效，建议后续补 `is_deleted` 或 `invalidated_at`

### 6.2 删除关系

删除关系时，建议：

1. 在 Neo4j 删除关系
2. 删除或失效 `entity_source_links` 中 `entity_type = edge` 且 `entity_id = edgeId` 的记录
3. 删除或失效 `evidence_records.edge_id = edgeId` 的记录
4. 写入 `graph_change_history`

### 6.3 合并节点

当两个节点被判定为同一实体时，建议定义“源节点 -> 目标节点”的合并规则。

合并时需要同步处理：

1. Neo4j 中把源节点的关系全部迁移到目标节点
2. `entity_source_links` 中所有源节点引用改写为目标节点 ID
3. `evidence_records.subject_node_id` / `target_node_id` 中的源节点 ID 改写为目标节点 ID
4. 写入 `graph_change_history`，记录 merge 动作和映射关系
5. 生成新快照和新版本

建议额外约定：

- 被合并掉的旧节点 ID 不要立即复用
- 如需保留追踪链路，可单独增加 `merged_into_node_id` 字段或映射表

## 7. 当前 PostgreSQL 是否已经为图数据库留好位置

结论：已经留好了主干，但必须按本文新增规则执行，才算真正可实现。

当前这套设计已经能支撑：

- Neo4j 作为最终图结构主存储
- PostgreSQL 负责任务、版本、快照、来源、证据、历史
- 任务结果先校验再入图
- 入图后可查询当前版本、回滚版本、追溯来源

当前这套设计故意不做的事情：

- 不在 PostgreSQL 再维护 `nodes` / `edges` 主表
- 不把前端布局或大块原始 JSON 当作 Neo4j 主存储
- 不把关系语义硬编码成数据库 schema
