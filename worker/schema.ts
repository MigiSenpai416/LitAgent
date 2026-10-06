import { z } from 'zod';

export const searchInputSchema = z.object({
  query: z.string().trim().min(3).max(500),
  mode: z.enum(['citations', 'fulltext']).default('citations'),
  useAgent: z.boolean().default(true),
  useDecisions: z.boolean().default(false),
  fromYear: z
    .number()
    .int()
    .min(1800)
    .max(new Date().getUTCFullYear())
    .nullable()
    .default(null),
});

export type SearchInput = z.infer<typeof searchInputSchema>;

export const planSchema = z.object({
  question: z.string().trim().min(3).max(700),
  concepts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(70),
        description: z.string().trim().min(1).max(250),
      }),
    )
    .min(1)
    .max(6),
  queries: z.array(z.string().trim().min(2).max(250)).min(1).max(3),
});

const locationSchema = z.object({
  is_oa: z.boolean().optional(),
  landing_page_url: z.string().nullable().optional(),
  pdf_url: z.string().nullable().optional(),
  source: z
    .object({ display_name: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

export const worksSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().regex(/^https:\/\/openalex.org\/W\d+$/),
      display_name: z.string().nullable(),
      doi: z.string().nullable().optional(),
      publication_year: z.number().nullable().optional(),
      cited_by_count: z.number().optional(),
      authorships: z
        .array(
          z.object({
            author: z.object({ display_name: z.string().nullable() }),
          }),
        )
        .optional(),
      abstract_inverted_index: z
        .record(z.string(), z.array(z.number().int().min(0).max(100000)))
        .nullable()
        .optional(),
      primary_location: locationSchema.nullable().optional(),
      best_oa_location: locationSchema.nullable().optional(),
      locations: z.array(locationSchema).optional(),
      topics: z.array(z.object({ display_name: z.string() })).optional(),
      is_retracted: z.boolean().optional(),
    }),
  ),
});

export type Work = z.infer<typeof worksSchema>['results'][number];
