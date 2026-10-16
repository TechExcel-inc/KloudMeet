-- Migration: Recording offline STT job state (Aliyun DashScope file transcription)

ALTER TABLE `Recording`
    ADD COLUMN `sttTaskId` VARCHAR(191) NULL,
    ADD COLUMN `sttStatus` VARCHAR(191) NULL,
    ADD COLUMN `sttStartedAt` DATETIME(3) NULL,
    ADD COLUMN `sttError` TEXT NULL;
