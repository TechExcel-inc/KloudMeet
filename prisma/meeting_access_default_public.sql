-- Migration: new meetings default to Public (was Protected).
-- The app now sets accessLevel on every new meeting itself, so this only changes the column
-- default for rows inserted without a value. Existing meetings keep their level.
ALTER TABLE `Meeting` ALTER COLUMN `accessLevel` SET DEFAULT 'PUBLIC';
