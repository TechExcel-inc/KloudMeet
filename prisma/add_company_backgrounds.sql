-- Migration: company camera backgrounds (Company settings → Camera backgrounds).
-- Only adds one table and two columns; existing rows keep working unchanged.

-- Images a company's owners and admins add for everyone in the company. Kept here and served from
-- this site, so they load quickly in mainland China and the camera cut-out can read them.
CREATE TABLE IF NOT EXISTS `AccountBackground` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `image` MEDIUMBLOB NOT NULL,
    `thumb` MEDIUMBLOB NOT NULL,
    `version` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdByMemberId` INTEGER NULL,
    `modifiedAt` DATETIME(3) NULL,
    INDEX `AccountBackground_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AccountBackground_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `KloudMeetAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The company's rules: the background members start with, and whether they may also use the
-- built-in scenes and their own images.
ALTER TABLE `KloudMeetAccount`
    ADD COLUMN `defaultBackgroundId` INTEGER NULL,
    ADD COLUMN `backgroundsCompanyOnly` BOOLEAN NOT NULL DEFAULT false;
