-- Migration: account linking (sign-in methods and Kloud company mapping).
-- Only adds columns and one table; existing rows keep working unchanged.

-- A Kloud Meet account can connect one Kloud (kloud.cn) user as a sign-in method.
ALTER TABLE `TeamMember`
    ADD COLUMN `kloudUserId` VARCHAR(32) NULL,
    ADD COLUMN `kloudLinkedAt` DATETIME(3) NULL,
    ADD COLUMN `kloudCompanies` JSON NULL,
    ADD COLUMN `kloudCompaniesAt` DATETIME(3) NULL,
    ADD UNIQUE INDEX `TeamMember_kloudUserId_key`(`kloudUserId`);

-- A Kloud Meet company can mirror one Kloud company; members flow one way, Kloud → Kloud Meet.
ALTER TABLE `KloudMeetAccount`
    ADD COLUMN `kloudCompanyId` VARCHAR(32) NULL,
    ADD COLUMN `kloudCompanyName` VARCHAR(191) NULL,
    ADD COLUMN `kloudLinkedAt` DATETIME(3) NULL,
    ADD COLUMN `kloudLinkedBy` INTEGER NULL,
    ADD UNIQUE INDEX `KloudMeetAccount_kloudCompanyId_key`(`kloudCompanyId`);

-- "Connect Google / Kloud" from My Profile: one-time intents, stored as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS `AccountLinkIntent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tokenHash` VARCHAR(64) NOT NULL,
    `teamMemberId` INTEGER NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AccountLinkIntent_tokenHash_key`(`tokenHash`),
    INDEX `AccountLinkIntent_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Emails are stored lower-case from now on. The unique index is case-insensitive, so no two rows
-- can differ only by case and this cannot collide.
UPDATE `TeamMember` SET `email` = LOWER(`email`) WHERE `email` IS NOT NULL AND BINARY `email` <> BINARY LOWER(`email`);
