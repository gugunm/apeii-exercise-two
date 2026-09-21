CREATE TABLE "api_keys" (
	"id" char(26) PRIMARY KEY,
	"name" varchar(255) NOT NULL,
	"key_hash" char(64) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" ("key_hash");