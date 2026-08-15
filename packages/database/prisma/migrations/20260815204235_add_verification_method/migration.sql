-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('QR', 'MANUAL');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'QR';
