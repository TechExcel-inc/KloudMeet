-- Migration: schedule dialog attendees, invitation and reminder emails

ALTER TABLE `Meeting`
    ADD COLUMN `inviteEmails` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `reminderEmails` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `reminderOffsets` JSON NULL;

CREATE TABLE IF NOT EXISTS `MeetingInvitee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `invitedAt` DATETIME(3) NULL,
    `invitedFor` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `MeetingInvitee_meetingId_email_key`(`meetingId`, `email`),
    INDEX `MeetingInvitee_meetingId_idx`(`meetingId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MeetingInvitee_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MeetingReminderLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `offsetMinutes` INTEGER NOT NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `MeetingReminderLog_meetingId_offsetMinutes_scheduledFor_key`(`meetingId`, `offsetMinutes`, `scheduledFor`),
    INDEX `MeetingReminderLog_meetingId_idx`(`meetingId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MeetingReminderLog_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
