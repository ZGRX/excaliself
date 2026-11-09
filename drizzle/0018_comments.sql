-- Comment threads pinned to a spot on a drawing, their comments, and who read them.
CREATE TABLE "comment_reads" (
	"userId" text NOT NULL,
	"threadId" text NOT NULL,
	"readAt" timestamp NOT NULL,
	CONSTRAINT "comment_reads_userId_threadId_pk" PRIMARY KEY("userId","threadId")
);
--> statement-breakpoint
CREATE TABLE "comment_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"drawingId" text NOT NULL,
	"createdBy" text,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"elementId" text,
	"offsetX" double precision,
	"offsetY" double precision,
	"resolvedAt" timestamp,
	"resolvedBy" text,
	"createdAt" timestamp NOT NULL,
	"lastActivityAt" timestamp NOT NULL,
	CONSTRAINT "comment_threads_element_anchor" CHECK (("comment_threads"."elementId" is null) = ("comment_threads"."offsetX" is null) and ("comment_threads"."elementId" is null) = ("comment_threads"."offsetY" is null))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"threadId" text NOT NULL,
	"authorId" text,
	"via" text,
	"body" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"editedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "comment_reads" ADD CONSTRAINT "comment_reads_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reads" ADD CONSTRAINT "comment_reads_threadId_comment_threads_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."comment_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_drawingId_drawings_id_fk" FOREIGN KEY ("drawingId") REFERENCES "public"."drawings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_resolvedBy_users_id_fk" FOREIGN KEY ("resolvedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_threadId_comment_threads_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."comment_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_users_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_threads_drawing" ON "comment_threads" USING btree ("drawingId");--> statement-breakpoint
CREATE INDEX "comments_thread" ON "comments" USING btree ("threadId","createdAt");