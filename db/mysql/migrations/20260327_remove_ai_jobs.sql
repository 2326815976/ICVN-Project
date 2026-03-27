USE `icvn_graph`;

SET @schema_name = DATABASE();

SET @drop_tasks_ai_job_fk = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = @schema_name
        AND TABLE_NAME = 'tasks'
        AND CONSTRAINT_NAME = 'fk_tasks_ai_job'
    ),
    'ALTER TABLE `tasks` DROP FOREIGN KEY `fk_tasks_ai_job`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @drop_tasks_ai_job_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_tasks_ai_job_idx = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'tasks'
        AND INDEX_NAME = 'idx_tasks_ai_job'
    ),
    'ALTER TABLE `tasks` DROP INDEX `idx_tasks_ai_job`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @drop_tasks_ai_job_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_tasks_ai_job_column = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'tasks'
        AND COLUMN_NAME = 'ai_job_id'
    ),
    'ALTER TABLE `tasks` DROP COLUMN `ai_job_id`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @drop_tasks_ai_job_column;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS `ai_jobs`;
