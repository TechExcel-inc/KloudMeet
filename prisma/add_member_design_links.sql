-- Migration: Design links (Figma) in the meetings a person hosts (My Profile → Meeting settings).
-- Off by default. Run it BEFORE deploying the code that uses it: every query that loads a whole
-- TeamMember row reads this column.
ALTER TABLE `TeamMember` ADD COLUMN `designLinksEnabled` TINYINT(1) NOT NULL DEFAULT 0;
