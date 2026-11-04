CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirectUris" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"clientId" text NOT NULL,
	"redirectUri" text NOT NULL,
	"codeHash" text,
	"codeChallenge" text NOT NULL,
	"codeExpiresAt" timestamp NOT NULL,
	"accessTokenHash" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenHash" text,
	"lastUsedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "oauth_grants_codeHash_unique" UNIQUE("codeHash"),
	CONSTRAINT "oauth_grants_accessTokenHash_unique" UNIQUE("accessTokenHash"),
	CONSTRAINT "oauth_grants_refreshTokenHash_unique" UNIQUE("refreshTokenHash")
);
--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_clientId_oauth_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;