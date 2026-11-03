-- Parallel uploads could store one image twice. Keep the oldest row, then
-- refuse new duplicates.
DELETE FROM "drawing_files" AS "dup"
USING "drawing_files" AS "kept"
WHERE "dup"."drawingId" = "kept"."drawingId"
  AND "dup"."fileId" = "kept"."fileId"
  AND ("dup"."createdAt", "dup"."id") > ("kept"."createdAt", "kept"."id");
--> statement-breakpoint
CREATE UNIQUE INDEX "drawing_files_one_row_per_file" ON "drawing_files" USING btree ("drawingId","fileId");
