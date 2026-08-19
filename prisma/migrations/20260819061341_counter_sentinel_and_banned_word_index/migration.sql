/*
  Warnings:

  - Made the column `creator_id` on table `donation_counter` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "donation_creator_status_idx";

-- DropIndex
DROP INDEX "donation_paid_at_idx";

-- DropIndex
DROP INDEX "mt_outbound_creator_idx";

-- AlterTable
ALTER TABLE "donation_counter" ALTER COLUMN "creator_id" SET NOT NULL,
ALTER COLUMN "creator_id" SET DEFAULT 'ALL';

-- CreateIndex
CREATE INDEX "banned_word_word_idx" ON "banned_word"("word");
