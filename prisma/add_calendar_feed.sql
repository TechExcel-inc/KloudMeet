-- Migration: private per-member calendar subscription feed (GET /api/calendar/feed/<token>.ics)
-- NULL = feed off. The token is a 256-bit random secret; resetting it revokes old subscriptions.

ALTER TABLE `TeamMember`
    ADD COLUMN `calendarFeedToken` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `TeamMember_calendarFeedToken_key` ON `TeamMember`(`calendarFeedToken`);
