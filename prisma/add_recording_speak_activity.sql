-- Migration: Recording media start time + speak activity token + RecordingSpeakInterval

ALTER TABLE `Recording`
    ADD COLUMN `mediaStartedAt` DATETIME(3) NULL,
    ADD COLUMN `activityToken` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Recording_activityToken_key` ON `Recording`(`activityToken`);

CREATE TABLE IF NOT EXISTS `RecordingSpeakInterval` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordingId` INTEGER NOT NULL,
    `participantIdentity` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NOT NULL,
    `avgLevel` DOUBLE NOT NULL,
    `peakLevel` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `RecordingSpeakInterval_recordingId_startedAt_idx`(`recordingId`, `startedAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `RecordingSpeakInterval_recordingId_fkey` FOREIGN KEY (`recordingId`) REFERENCES `Recording`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
