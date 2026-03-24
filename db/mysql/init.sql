CREATE DATABASE IF NOT EXISTS `icvn_graph`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `icvn_graph`;

CREATE TABLE IF NOT EXISTS `graphs` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `graph_nodes` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `type` VARCHAR(64) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `properties` JSON NOT NULL,
  `position_x` DOUBLE NULL,
  `position_y` DOUBLE NULL,
  `occurred_at` DATE NULL,
  `period_start` DATE NULL,
  `period_end` DATE NULL,
  `place_id` VARCHAR(64) NULL,
  `participants` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_graph_nodes_graph` (`graph_id`),
  KEY `idx_graph_nodes_type` (`type`),
  CONSTRAINT `fk_graph_nodes_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `graph_edges` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(64) NOT NULL,
  `target_id` VARCHAR(64) NOT NULL,
  `relation` VARCHAR(128) NOT NULL,
  `label` VARCHAR(255) NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `weight` DOUBLE NULL,
  `properties` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_graph_edges_graph` (`graph_id`),
  KEY `idx_graph_edges_source` (`source_id`),
  KEY `idx_graph_edges_target` (`target_id`),
  CONSTRAINT `fk_graph_edges_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_graph_edges_source` FOREIGN KEY (`source_id`) REFERENCES `graph_nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_graph_edges_target` FOREIGN KEY (`target_id`) REFERENCES `graph_nodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `graph_snapshots` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_graph_snapshots_graph` (`graph_id`),
  CONSTRAINT `fk_graph_snapshots_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `graph_versions` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `version_no` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `trigger` VARCHAR(32) NOT NULL,
  `snapshot_id` VARCHAR(64) NOT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_graph_versions_graph_version_no` (`graph_id`, `version_no`),
  UNIQUE KEY `uniq_graph_versions_snapshot_id` (`snapshot_id`),
  KEY `idx_graph_versions_graph_created` (`graph_id`, `created_at`),
  CONSTRAINT `fk_graph_versions_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_graph_versions_snapshot` FOREIGN KEY (`snapshot_id`) REFERENCES `graph_snapshots` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_jobs` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `task_id` VARCHAR(64) NULL,
  `source_type` VARCHAR(32) NOT NULL,
  `input_text` LONGTEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `result_json` JSON NULL,
  `error_message` TEXT NULL,
  `provider` VARCHAR(128) NULL,
  `model` VARCHAR(128) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ai_jobs_graph` (`graph_id`),
  KEY `idx_ai_jobs_task` (`task_id`),
  CONSTRAINT `fk_ai_jobs_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `source_type` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `input_text` LONGTEXT NULL,
  `content_preview` TEXT NULL,
  `status` VARCHAR(32) NOT NULL,
  `error_message` TEXT NULL,
  `idempotency_key` VARCHAR(128) NULL,
  `ai_job_id` VARCHAR(64) NULL,
  `applied_version_id` VARCHAR(64) NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_tasks_idempotency_key` (`idempotency_key`),
  KEY `idx_tasks_graph_status` (`graph_id`, `status`, `created_at`),
  KEY `idx_tasks_ai_job` (`ai_job_id`),
  KEY `idx_tasks_applied_version` (`applied_version_id`),
  CONSTRAINT `fk_tasks_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tasks_ai_job` FOREIGN KEY (`ai_job_id`) REFERENCES `ai_jobs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tasks_applied_version` FOREIGN KEY (`applied_version_id`) REFERENCES `graph_versions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_files` (
  `id` VARCHAR(64) NOT NULL,
  `task_id` VARCHAR(64) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(128) NOT NULL,
  `file_size` BIGINT NULL,
  `storage_key` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_task_files_task` (`task_id`),
  CONSTRAINT `fk_task_files_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_results` (
  `id` VARCHAR(64) NOT NULL,
  `task_id` VARCHAR(64) NOT NULL,
  `raw_result` JSON NULL,
  `normalized_result` JSON NULL,
  `node_count` INT NOT NULL DEFAULT 0,
  `edge_count` INT NOT NULL DEFAULT 0,
  `event_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_task_results_task` (`task_id`),
  CONSTRAINT `fk_task_results_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_events` (
  `id` VARCHAR(64) NOT NULL,
  `task_id` VARCHAR(64) NOT NULL,
  `seq` INT NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `message` TEXT NOT NULL,
  `payload` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_task_events_task_seq` (`task_id`, `seq`),
  KEY `idx_task_events_task_created` (`task_id`, `created_at`),
  CONSTRAINT `fk_task_events_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `source_records` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `source_type` VARCHAR(32) NOT NULL,
  `source_ref_id` VARCHAR(128) NULL,
  `title` VARCHAR(255) NOT NULL,
  `content` TEXT NULL,
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_source_records_graph` (`graph_id`),
  KEY `idx_source_records_ref` (`source_ref_id`),
  CONSTRAINT `fk_source_records_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `entity_source_links` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `entity_type` VARCHAR(16) NOT NULL,
  `entity_id` VARCHAR(64) NOT NULL,
  `source_record_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_entity_source_links_entity` (`entity_type`, `entity_id`),
  KEY `idx_entity_source_links_source` (`source_record_id`),
  CONSTRAINT `fk_entity_source_links_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_entity_source_links_source` FOREIGN KEY (`source_record_id`) REFERENCES `source_records` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `evidence_records` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `source_record_id` VARCHAR(64) NOT NULL,
  `subject_node_id` VARCHAR(64) NOT NULL,
  `target_node_id` VARCHAR(64) NULL,
  `edge_id` VARCHAR(64) NULL,
  `relation` VARCHAR(128) NULL,
  `excerpt` TEXT NOT NULL,
  `speaker` VARCHAR(255) NULL,
  `page_no` INT NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_evidence_records_graph` (`graph_id`),
  KEY `idx_evidence_records_subject` (`subject_node_id`),
  KEY `idx_evidence_records_edge` (`edge_id`),
  CONSTRAINT `fk_evidence_records_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_evidence_records_source` FOREIGN KEY (`source_record_id`) REFERENCES `source_records` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `graph_change_history` (
  `id` VARCHAR(64) NOT NULL,
  `graph_id` VARCHAR(64) NOT NULL,
  `entity_type` VARCHAR(16) NOT NULL,
  `entity_id` VARCHAR(64) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `field_name` VARCHAR(128) NULL,
  `old_value` JSON NULL,
  `new_value` JSON NULL,
  `operator_id` VARCHAR(64) NOT NULL,
  `source_record_id` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_graph_change_history_entity` (`graph_id`, `entity_type`, `entity_id`, `created_at`),
  KEY `idx_graph_change_history_source` (`source_record_id`),
  CONSTRAINT `fk_graph_change_history_graph` FOREIGN KEY (`graph_id`) REFERENCES `graphs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_graph_change_history_source` FOREIGN KEY (`source_record_id`) REFERENCES `source_records` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `graphs` (`id`, `name`, `description`, `status`, `created_by`)
VALUES ('default', 'Default Graph', '系统默认图谱', 'active', 'system');
