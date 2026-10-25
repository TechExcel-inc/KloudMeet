-- Migration: LiveDoc Full Recording (pre-join recording option, Kloud recording link, media sections)

ALTER TABLE `Meeting`
    ADD COLUMN `recordingOption` VARCHAR(191) NOT NULL DEFAULT 'screen_share';

ALTER TABLE `Recording`
    ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'screen_share',
    ADD COLUMN `livedocRecordingId` INTEGER NULL,
    ADD COLUMN `livedocStartedAt` DATETIME(3) NULL,
    ADD COLUMN `livedocToken` TEXT NULL;

CREATE TABLE `RecordingSection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordingId` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PROCESSING',
    `startMs` INTEGER NULL,
    `endMs` INTEGER NULL,
    `userId` VARCHAR(191) NULL,
    `providerRef` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecordingSection_recordingId_fkey`(`recordingId`),
    INDEX `RecordingSection_providerRef_idx`(`providerRef`),
    PRIMARY KEY (`id`),
    CONSTRAINT `RecordingSection_recordingId_fkey` FOREIGN KEY (`recordingId`) REFERENCES `Recording`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
