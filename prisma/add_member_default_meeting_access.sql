-- Migration: each person's default access level for new meetings (My Profile → Meeting settings).
-- NULL = never set = Public. Run it BEFORE deploying the code that uses it: every query that
-- loads a whole TeamMember row reads this column.
ALTER TABLE `TeamMember` ADD COLUMN `defaultMeetingAccess` VARCHAR(16) NULL;
