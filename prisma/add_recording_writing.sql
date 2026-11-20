CREATE TABLE IF NOT EXISTS `RecordingWriting` (
  `recordingId` INT NOT NULL,
  `minutes` INT NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `content` JSON NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`recordingId`, `minutes`),
  CONSTRAINT `RecordingWriting_recordingId_fkey` FOREIGN KEY (`recordingId`) REFERENCES `Recording` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
