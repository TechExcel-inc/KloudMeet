-- Migration: structured AI summary (topic, overview, to-dos) and per-section points with times

ALTER TABLE `MeetingSummaryItem`
    ADD COLUMN `points` JSON NULL;

CREATE TABLE IF NOT EXISTS `MeetingSummary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `topic` VARCHAR(500) NULL,
    `overview` TEXT NULL,
    `speakers` JSON NULL,
    `todos` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `MeetingSummary_meetingId_key`(`meetingId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MeetingSummary_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
