-- Migration: record which AI model wrote a meeting summary, and why it fell back (internal note)

ALTER TABLE `MeetingSummary`
    ADD COLUMN `model` VARCHAR(100) NULL,
    ADD COLUMN `fallbackReason` VARCHAR(200) NULL;
