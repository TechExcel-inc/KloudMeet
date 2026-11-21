-- Apply after add_recording_writing.sql.
ALTER TABLE `RecordingWriting`
  ADD COLUMN `id` VARCHAR(36) NULL,
  ADD COLUMN `name` VARCHAR(200) NULL,
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `voice` VARCHAR(16) NOT NULL DEFAULT 'marin';

UPDATE `RecordingWriting` SET `id` = CONCAT('legacy-', `minutes`) WHERE `id` IS NULL;

ALTER TABLE `RecordingWriting`
  MODIFY COLUMN `id` VARCHAR(36) NOT NULL,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`recordingId`, `id`);
