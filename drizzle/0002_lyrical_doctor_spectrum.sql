CREATE TABLE "llm_user_rate_limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"requests_per_hour" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_user_rate_limits_requests_per_hour_check" CHECK ("llm_user_rate_limits"."requests_per_hour" = -1 OR "llm_user_rate_limits"."requests_per_hour" > 0)
);
