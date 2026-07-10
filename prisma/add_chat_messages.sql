-- Migration: Persist meeting chat messages

CREATE TABLE IF NOT EXISTS `MeetingChatMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `clientMessageId` VARCHAR(191) NOT NULL,
    `senderIdentity` VARCHAR(191) NOT NULL,
    `senderName` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `sentAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `MeetingChatMessage_meetingId_clientMessageId_key`(`meetingId`, `clientMessageId`),
    INDEX `MeetingChatMessage_meetingId_sentAt_id_idx`(`meetingId`, `sentAt`, `id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MeetingChatMessage_meetingId_fkey`
      FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
