-- Migration: persist chapter speaker on MeetingSummaryItem (AI generate already returns it)

ALTER TABLE `MeetingSummaryItem`
    ADD COLUMN `speaker` VARCHAR(191) NULL;
