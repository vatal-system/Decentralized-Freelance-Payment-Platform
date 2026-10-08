-- CreateTable
CREATE TABLE "AuthNonce" (
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("address")
);
