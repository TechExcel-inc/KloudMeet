-- Migration: meeting access levels (Public / Protected / Private), invitee join links, knock requests.
-- All additive: existing code keeps working after it runs. Run it BEFORE deploying the code that uses it.

-- 1) Meeting.accessLevel. Existing meetings stay NULL (= legacy: anyone with the link joins, recordings
--    keep their current rule). The default is set in a second statement so MySQL does not backfill
--    existing rows with it; meetings created from now on get PROTECTED.
ALTER TABLE `Meeting` ADD COLUMN `accessLevel` VARCHAR(16) NULL;
ALTER TABLE `Meeting` ALTER COLUMN `accessLevel` SET DEFAULT 'PROTECTED';

-- 2) MeetingInvitee.joinToken: each invited person's own join link (/rooms/<room>?invite=<token>).
ALTER TABLE `MeetingInvitee`
    ADD COLUMN `joinToken` VARCHAR(64) NULL,
    ADD UNIQUE INDEX `MeetingInvitee_joinToken_key` (`joinToken`);

-- 3) MeetingJoinRequest: someone who isn't invited asks to join a Protected meeting ("knock").
CREATE TABLE IF NOT EXISTS `MeetingJoinRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `teamMemberId` INTEGER NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    -- PENDING | ADMITTED | DENIED | CANCELED
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `respondedByMemberId` INTEGER NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `MeetingJoinRequest_meetingId_teamMemberId_key` (`meetingId`, `teamMemberId`),
    INDEX `MeetingJoinRequest_meetingId_status_idx` (`meetingId`, `status`),
    CONSTRAINT `MeetingJoinRequest_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
