CREATE TYPE "doc_summary_job_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "doc_summary_jobs" (
	"id" char(26) PRIMARY KEY,
	"content" text NOT NULL,
	"status" "doc_summary_job_status" DEFAULT 'PENDING'::"doc_summary_job_status" NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_summary_results" (
	"id" char(26) PRIMARY KEY,
	"job_id" char(26) NOT NULL UNIQUE,
	"content_title" varchar(255) NOT NULL,
	"content_summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "doc_summary_jobs_status_created_at_idx" ON "doc_summary_jobs" ("status","created_at");--> statement-breakpoint
ALTER TABLE "doc_summary_results" ADD CONSTRAINT "doc_summary_results_job_id_doc_summary_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "doc_summary_jobs"("id") ON DELETE CASCADE;