-- Migration: recording controls (only host can record, cloud recording mode, sync transcript, pause)

ALTER TABLE `Meeting`
    ADD COLUMN `recordingHostOnly` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `recordingMode` VARCHAR(191) NOT NULL DEFAULT 'follow',
    ADD COLUMN `recordingSyncTranscript` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `meetingRoles` JSON NULL;

ALTER TABLE `Recording`
    ADD COLUMN `mode` VARCHAR(191) NOT NULL DEFAULT 'follow',
    ADD COLUMN `pausedAt` DATETIME(3) NULL,
    ADD COLUMN `pauseSpans` JSON NULL,
    ADD COLUMN `syncTranscript` BOOLEAN NOT NULL DEFAULT true;
