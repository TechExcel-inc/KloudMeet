-- Migration: desktop Google sign-in hand-off (browser → kloudmeet://auth → app exchanges code + PKCE verifier).
-- Codes are stored as SHA-256 hashes, live 5 minutes and work once.

CREATE TABLE IF NOT EXISTS `DesktopAuthHandoff` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codeHash` VARCHAR(64) NOT NULL,
    `teamMemberId` INTEGER NOT NULL,
    `challenge` VARCHAR(64) NOT NULL,
    `next` VARCHAR(512) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `DesktopAuthHandoff_codeHash_key`(`codeHash`),
    INDEX `DesktopAuthHandoff_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
