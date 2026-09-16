CREATE TYPE "bsre_totp_kind" AS ENUM('ACTIVATION', 'SEAL');--> statement-breakpoint
CREATE TYPE "eseal_batch_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "eseal_batch_step" AS ENUM('QUEUED', 'DOWNLOADING', 'SEALING', 'UPLOADING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "eseal_log_level" AS ENUM('INFO', 'ERROR');--> statement-breakpoint
CREATE TABLE "bsre_totp" (
	"kind" "bsre_totp_kind" PRIMARY KEY,
	"totp" varchar(10) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eseal_batches" (
	"id" char(26) PRIMARY KEY,
	"user_id" varchar(255) NOT NULL,
	"status" "eseal_batch_status" DEFAULT 'PENDING'::"eseal_batch_status" NOT NULL,
	"current_step" "eseal_batch_step" DEFAULT 'QUEUED'::"eseal_batch_step" NOT NULL,
	"seal_config" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eseal_files" (
	"id" char(26) PRIMARY KEY,
	"batch_id" char(26) NOT NULL,
	"position" smallint NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"file_size" bigint NOT NULL,
	"raw_path" text NOT NULL,
	"verified_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eseal_logs" (
	"id" char(26) PRIMARY KEY,
	"batch_id" char(26) NOT NULL,
	"level" "eseal_log_level" NOT NULL,
	"step" "eseal_batch_step" NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "eseal_batches_status_created_at_idx" ON "eseal_batches" ("status","created_at");--> statement-breakpoint
CREATE INDEX "eseal_files_batch_id_position_idx" ON "eseal_files" ("batch_id","position");--> statement-breakpoint
CREATE INDEX "eseal_logs_batch_id_created_at_idx" ON "eseal_logs" ("batch_id","created_at");--> statement-breakpoint
ALTER TABLE "eseal_files" ADD CONSTRAINT "eseal_files_batch_id_eseal_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "eseal_batches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eseal_logs" ADD CONSTRAINT "eseal_logs_batch_id_eseal_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "eseal_batches"("id") ON DELETE CASCADE;