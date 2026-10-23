-- Verification codes: count wrong guesses (max 5 per code) and look up recent codes per target.
ALTER TABLE `VerificationCode` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0;
CREATE INDEX `VerificationCode_target_type_createdAt_idx` ON `VerificationCode`(`target`, `type`, `createdAt`);
