-- LiveDoc Full replay: who was in the meeting, and whether their mic and camera were on.

CREATE TABLE `RecordingPresence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordingId` INTEGER NOT NULL,
    `identity` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `kind` VARCHAR(191) NOT NULL,
    `on` BOOLEAN NOT NULL,
    `atMs` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecordingPresence_recordingId_atMs_idx`(`recordingId`, `atMs`),
    PRIMARY KEY (`id`),
    CONSTRAINT `RecordingPresence_recordingId_fkey` FOREIGN KEY (`recordingId`) REFERENCES `Recording`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
