import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const resume = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/resume' }),
  schema: z.object({
    lang: z.enum(['en', 'ru']),
    name: z.string(),
    title: z.string(),
    location: z.string(),
    contacts: z.object({
      phone: z.string(),
      telegram: z.string(),
      email: z.string(),
      linkedin: z.string(),
      github: z.string(),
    }),
    ui: z.object({
      pdf: z.string(),
      switchTo: z.string(),
      phone: z.string(),
    }),
  }),
});

export const collections = { resume };
