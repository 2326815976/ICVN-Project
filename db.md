# 数据库设计说明

当前项目已收敛为“任务驱动的人物关系图”方案，不再维护版本快照体系，也不再预留独立图数据库主存储。

## 存储边界

- MySQL：保存图谱节点、关系、任务、来源、证据、变更历史
- 应用层：负责子图、关系详情、搜索等查询拼装
- API 字段使用 `camelCase`
- 数据库字段使用 `snake_case`

## 核心表

### graphs

图谱作用域表，对应所有 `graphId`。

### graph_nodes

保存人物、组织、地点、事件等节点。

关键字段：

- `id`
- `graph_id`
- `type`
- `label`
- `properties`
- `occurred_at`
- `period_start`
- `period_end`
- `place_id`
- `participants`

### graph_edges

保存节点之间的关系。

关键字段：

- `id`
- `graph_id`
- `source_id`
- `target_id`
- `relation`
- `label`
- `start_date`
- `end_date`
- `weight`
- `properties`

### tasks

保存导入任务及处理状态。

关键字段：

- `id`
- `graph_id`
- `source_type`
- `title`
- `input_text`
- `content_preview`
- `status`
- `error_message`

### task_files

保存任务关联文件元信息。

### task_results

保存任务标准化后的结构化结果。

关键字段：

- `raw_result`
- `normalized_result`
- `node_count`
- `edge_count`
- `event_count`

### task_events

保存任务处理事件流，例如：

- `uploaded`
- `queued`
- `processing`
- `validated`
- `applied`

### source_records

保存来源记录，例如人工录入、任务导入、AI 补充。

### entity_source_links

保存实体与来源的映射关系，用于追溯节点或关系来自哪里。

### evidence_records

保存可直接展示的证据片段。

关键字段：

- `source_record_id`
- `subject_node_id`
- `target_node_id`
- `edge_id`
- `relation`
- `excerpt`
- `speaker`
- `page_no`

### graph_change_history

保存节点或关系的创建、更新、删除记录。

关键字段：

- `graph_id`
- `entity_type`
- `entity_id`
- `action`
- `field_name`
- `old_value`
- `new_value`
- `operator_id`
- `source_record_id`

## 当前设计原则

1. 不保存图谱版本快照。
2. 不维护 `graph_versions` / `graph_snapshots`。
3. 任务应用入图后，只更新当前图状态。
4. 需要追溯时，优先依赖：
   - `task_events`
   - `graph_change_history`
   - `source_records`
   - `evidence_records`

## 推荐主流程

1. 创建任务。
2. 调用 `/tasks/{taskId}/parse` 提交文本内容。
3. 生成标准化结果并写入 `task_results`。
4. 前端预览任务结果。
5. 调用 `/tasks/{taskId}/apply` 正式入图。
6. 写入来源、证据、变更历史。

## 不再保留的设计

- 图谱版本列表
- 版本详情
- 版本回滚
- 独立 AI job 查询接口
