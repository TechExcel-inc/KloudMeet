-- Migration: Kloud Meet billing v1 (see reports/KloudMeet计费模型设计.md)
-- Four new tables; no existing table is altered. Safe to run while BILLING_ENABLED is off.

CREATE TABLE IF NOT EXISTS `BillingSubscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NOT NULL,
    `plan` VARCHAR(191) NOT NULL DEFAULT 'FREE',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `interval` VARCHAR(191) NULL,
    `seats` INTEGER NOT NULL DEFAULT 1,
    `currentPeriodStart` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    `stripeCustomerId` VARCHAR(191) NULL,
    `stripeSubscriptionId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'STRIPE',
    `lastStripeEventAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `modifiedAt` DATETIME(3) NULL,
    UNIQUE INDEX `BillingSubscription_accountId_key`(`accountId`),
    UNIQUE INDEX `BillingSubscription_stripeCustomerId_key`(`stripeCustomerId`),
    UNIQUE INDEX `BillingSubscription_stripeSubscriptionId_key`(`stripeSubscriptionId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `BillingSubscription_accountId_fkey`
      FOREIGN KEY (`accountId`) REFERENCES `KloudMeetAccount`(`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `BillingSeat` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NOT NULL,
    `teamMemberId` INTEGER NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedByMemberId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `BillingSeat_accountId_teamMemberId_key`(`accountId`, `teamMemberId`),
    INDEX `BillingSeat_teamMemberId_idx`(`teamMemberId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `BillingSeat_accountId_fkey`
      FOREIGN KEY (`accountId`) REFERENCES `KloudMeetAccount`(`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `UsageEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NULL,
    `teamMemberId` INTEGER NULL,
    `meetingId` INTEGER NULL,
    `kind` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `sourceRef` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `UsageEvent_sourceRef_key`(`sourceRef`),
    INDEX `UsageEvent_accountId_kind_occurredAt_idx`(`accountId`, `kind`, `occurredAt`),
    INDEX `UsageEvent_teamMemberId_kind_occurredAt_idx`(`teamMemberId`, `kind`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `BillingCredit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NOT NULL,
    `seconds` INTEGER NOT NULL,
    `consumedSeconds` INTEGER NOT NULL DEFAULT 0,
    `purchasedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `stripeRef` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `BillingCredit_stripeRef_key`(`stripeRef`),
    INDEX `BillingCredit_accountId_expiresAt_idx`(`accountId`, `expiresAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `BillingCredit_accountId_fkey`
      FOREIGN KEY (`accountId`) REFERENCES `KloudMeetAccount`(`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
