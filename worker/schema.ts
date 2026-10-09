import { z } from 'zod';
import { MAX_SEARCH_ROUNDS } from '../shared/types';

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

const instructionsSchema = z.string().trim().min(3).max(500);

const searchPlanSchema = planSchema.extend({
  source: z.enum(['agent', 'keywords']),
  queries: z.array(z.string().trim().min(2).max(500)).min(1).max(3),
});

export const paginationSchema = z
  .object({
    plan: searchPlanSchema,
    paths: z
      .array(
        z.object({
          query: z.string().trim().min(2).max(500),
          cursor: z.string().trim().min(1).max(4096),
        }),
      )
      .min(1)
      .max(3),
  })
  .refine(
    (pagination) =>
      pagination.paths.every((path) =>
        pagination.plan.queries.includes(path.query),
      ) &&
      new Set(pagination.paths.map((path) => path.query)).size ===
        pagination.paths.length,
    'Pagination paths must belong to the search plan and be distinct.',
  );

export const refinementSchema = z.object({
  instructions: instructionsSchema,
  history: z
    .array(
      z.object({
        instructions: instructionsSchema.nullable(),
        plan: searchPlanSchema,
        queriesSearched: z.array(z.string().trim().min(2).max(500)).max(3),
        retrieved: z.number().int().nonnegative(),
        returned: z.number().int().nonnegative(),
        sampleTitles: z.array(z.string().trim().min(1).max(200)).max(5),
        warnings: z.array(z.string().max(500)).max(10),
      }),
    )
    .min(1)
    .max(MAX_SEARCH_ROUNDS - 1),
});

export const searchInputSchema = z.object({
  query: z.string().trim().min(3).max(500),
  refinement: refinementSchema.optional(),
  pagination: paginationSchema.optional(),
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
  meta: z
    .object({ next_cursor: z.string().max(4096).nullable().optional() })
    .optional(),
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
