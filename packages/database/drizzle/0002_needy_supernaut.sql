CREATE TABLE "cupmemo"."brew_pours" (
	"brew_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"water_grams" numeric(7, 2) NOT NULL,
	"start_time_seconds" integer NOT NULL,
	CONSTRAINT "brew_pours_brew_id_position_pk" PRIMARY KEY("brew_id","position"),
	CONSTRAINT "brew_pours_position_nonnegative" CHECK ("cupmemo"."brew_pours"."position" >= 0),
	CONSTRAINT "brew_pours_start_nonnegative" CHECK ("cupmemo"."brew_pours"."start_time_seconds" >= 0),
	CONSTRAINT "brew_pours_water_positive_finite" CHECK ("cupmemo"."brew_pours"."water_grams" > 0 AND "cupmemo"."brew_pours"."water_grams" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric))
);
--> statement-breakpoint
CREATE TABLE "cupmemo"."brew_tasting_tags" (
	"brew_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "brew_tasting_tags_brew_id_tag_pk" PRIMARY KEY("brew_id","tag"),
	CONSTRAINT "brew_tasting_tags_nonblank" CHECK ("cupmemo"."brew_tasting_tags"."tag" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "cupmemo"."brews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"coffee_id" uuid NOT NULL,
	"brewer" text NOT NULL,
	"grinder" text NOT NULL,
	"grind_setting" text NOT NULL,
	"dose_grams" numeric(7, 2) NOT NULL,
	"water_grams" numeric(7, 2) NOT NULL,
	"water_temperature_c" numeric(5, 2) NOT NULL,
	"total_brew_time_seconds" integer NOT NULL,
	"overall_score" numeric(5, 2) NOT NULL,
	"tasting_mode" text DEFAULT 'quick' NOT NULL,
	"acidity" numeric(4, 2),
	"body" numeric(4, 2),
	"aftertaste" numeric(4, 2),
	"fragrance_aroma" numeric(4, 2),
	"flavor" numeric(4, 2),
	"balance" numeric(4, 2),
	"sweetness" numeric(4, 2),
	"overall_impression" numeric(4, 2),
	"notes" text,
	"brewed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brews_brewer_nonblank" CHECK ("cupmemo"."brews"."brewer" ~ '[^[:space:]]'),
	CONSTRAINT "brews_grinder_nonblank" CHECK ("cupmemo"."brews"."grinder" ~ '[^[:space:]]'),
	CONSTRAINT "brews_grind_setting_nonblank" CHECK ("cupmemo"."brews"."grind_setting" ~ '[^[:space:]]'),
	CONSTRAINT "brews_dose_positive_finite" CHECK ("cupmemo"."brews"."dose_grams" > 0 AND "cupmemo"."brews"."dose_grams" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
	CONSTRAINT "brews_water_positive_finite" CHECK ("cupmemo"."brews"."water_grams" > 0 AND "cupmemo"."brews"."water_grams" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
	CONSTRAINT "brews_temperature_range" CHECK ("cupmemo"."brews"."water_temperature_c" BETWEEN 0 AND 100),
	CONSTRAINT "brews_duration_nonnegative" CHECK ("cupmemo"."brews"."total_brew_time_seconds" >= 0),
	CONSTRAINT "brews_overall_score_quarter" CHECK ("cupmemo"."brews"."overall_score" BETWEEN 0 AND 100 AND mod("cupmemo"."brews"."overall_score", 0.25) = 0),
	CONSTRAINT "brews_tasting_mode" CHECK ("cupmemo"."brews"."tasting_mode" IN ('quick', 'sensory')),
	CONSTRAINT "brews_acidity_quarter" CHECK ("cupmemo"."brews"."acidity" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."acidity", 0.25) = 0),
	CONSTRAINT "brews_body_quarter" CHECK ("cupmemo"."brews"."body" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."body", 0.25) = 0),
	CONSTRAINT "brews_aftertaste_quarter" CHECK ("cupmemo"."brews"."aftertaste" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."aftertaste", 0.25) = 0),
	CONSTRAINT "brews_fragrance_aroma_quarter" CHECK ("cupmemo"."brews"."fragrance_aroma" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."fragrance_aroma", 0.25) = 0),
	CONSTRAINT "brews_flavor_quarter" CHECK ("cupmemo"."brews"."flavor" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."flavor", 0.25) = 0),
	CONSTRAINT "brews_balance_quarter" CHECK ("cupmemo"."brews"."balance" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."balance", 0.25) = 0),
	CONSTRAINT "brews_sweetness_quarter" CHECK ("cupmemo"."brews"."sweetness" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."sweetness", 0.25) = 0),
	CONSTRAINT "brews_overall_impression_quarter" CHECK ("cupmemo"."brews"."overall_impression" BETWEEN 0 AND 10 AND mod("cupmemo"."brews"."overall_impression", 0.25) = 0)
);
--> statement-breakpoint
CREATE TABLE "cupmemo"."coffee_tasting_notes" (
	"coffee_id" uuid NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "coffee_tasting_notes_coffee_id_note_pk" PRIMARY KEY("coffee_id","note"),
	CONSTRAINT "coffee_tasting_notes_nonblank" CHECK ("cupmemo"."coffee_tasting_notes"."note" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "cupmemo"."coffees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"roaster" text NOT NULL,
	"country" text,
	"region" text,
	"farm_station" text,
	"producer" text,
	"variety" text,
	"process" text,
	"elevation" text,
	"roast_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coffees_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "coffees_name_nonblank" CHECK ("cupmemo"."coffees"."name" ~ '[^[:space:]]'),
	CONSTRAINT "coffees_roaster_nonblank" CHECK ("cupmemo"."coffees"."roaster" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "cupmemo"."brew_pours" ADD CONSTRAINT "brew_pours_brew_id_brews_id_fk" FOREIGN KEY ("brew_id") REFERENCES "cupmemo"."brews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupmemo"."brew_tasting_tags" ADD CONSTRAINT "brew_tasting_tags_brew_id_brews_id_fk" FOREIGN KEY ("brew_id") REFERENCES "cupmemo"."brews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupmemo"."brews" ADD CONSTRAINT "brews_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupmemo"."brews" ADD CONSTRAINT "brews_coffee_owner_fk" FOREIGN KEY ("coffee_id","owner_id") REFERENCES "cupmemo"."coffees"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupmemo"."coffee_tasting_notes" ADD CONSTRAINT "coffee_tasting_notes_coffee_id_coffees_id_fk" FOREIGN KEY ("coffee_id") REFERENCES "cupmemo"."coffees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupmemo"."coffees" ADD CONSTRAINT "coffees_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brews_owner_brewed_idx" ON "cupmemo"."brews" USING btree ("owner_id","brewed_at");--> statement-breakpoint
CREATE INDEX "brews_coffee_owner_brewed_idx" ON "cupmemo"."brews" USING btree ("coffee_id","owner_id","brewed_at");--> statement-breakpoint
CREATE INDEX "coffees_owner_created_idx" ON "cupmemo"."coffees" USING btree ("owner_id","created_at");