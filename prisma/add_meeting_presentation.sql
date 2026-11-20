-- Migration: AI presentation of a meeting (slides that play by themselves; lib/meetingPresentation.ts).
-- Made as soon as an AI Notes session ends, so it is ready when the replay is opened.
-- Until this table exists the replay page still works; it just has no presentation.

CREATE TABLE IF NOT EXISTS `MeetingPresentation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'GENERATING',
    `content` JSON NULL,
    `model` VARCHAR(100) NULL,
    `error` VARCHAR(500) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `MeetingPresentation_meetingId_key`(`meetingId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MeetingPresentation_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
