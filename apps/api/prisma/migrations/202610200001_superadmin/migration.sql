
-- Stop rather than guess if a database has multiple administrators.
DO $$ BEGIN
  IF (SELECT count(*) FROM "User" WHERE role = 'admin') > 1 THEN
    RAISE EXCEPTION 'Multiple administrators: select the owner before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM "User" WHERE role = 'admin' AND ("blockedAt" IS NOT NULL OR "deletedAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Existing administrator is disabled; restore intentionally before migration';
  END IF;
END $$;
ALTER TYPE "Role" RENAME VALUE 'admin' TO 'SUPERADMIN';
ALTER TABLE "User"
 ADD COLUMN surname TEXT NOT NULL DEFAULT '',
 ADD COLUMN phone TEXT NOT NULL DEFAULT '',
 ADD COLUMN bio TEXT NOT NULL DEFAULT '',
 ADD COLUMN "photoAssetId" UUID,
 ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3),
 ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuthSession" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "FileAsset"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "User_single_superadmin" ON "User" ((role)) WHERE role = 'SUPERADMIN';
CREATE UNIQUE INDEX "User_email_case_insensitive" ON "User" (lower(email));
ALTER TABLE "User" ADD CONSTRAINT "User_reserved_login" CHECK (lower(email) <> 'supadmin@teachem' OR role = 'SUPERADMIN');
ALTER TABLE "User" ADD CONSTRAINT "User_superadmin_active" CHECK (role <> 'SUPERADMIN' OR ("blockedAt" IS NULL AND "deletedAt" IS NULL AND NOT "mustChangePassword"));
CREATE FUNCTION protect_superadmin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.role = 'SUPERADMIN' THEN
   IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cannot delete the sole superadministrator'; END IF;
   IF NEW.role <> 'SUPERADMIN' OR NEW.id <> OLD.id THEN RAISE EXCEPTION 'Cannot demote or replace the sole superadministrator'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER protect_superadmin BEFORE UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION protect_superadmin();
-- Deferred invariant also supports a fresh installation: its first user must be the superadmin.
CREATE FUNCTION require_superadmin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT count(*) FROM "User" WHERE role = 'SUPERADMIN') <> 1 THEN RAISE EXCEPTION 'Exactly one superadministrator is required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_superadmin AFTER INSERT OR UPDATE OR DELETE ON "User" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_superadmin();
CREATE FUNCTION prevent_user_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'User truncation would remove the sole superadministrator'; END $$;
CREATE TRIGGER prevent_user_truncate BEFORE TRUNCATE ON "User" EXECUTE FUNCTION prevent_user_truncate();
UPDATE "AuthSession" SET "revokedAt" = now() WHERE "userId" IN (SELECT id FROM "User" WHERE role = 'SUPERADMIN');
