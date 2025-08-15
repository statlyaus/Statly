import { z } from 'zod';

const envSchema = z
  .object({
    FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: z
      .string()
      .min(1, 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is required')
      .superRefine((val, ctx) => {
        try {
          const json = Buffer.from(val, 'base64').toString('utf-8');
          JSON.parse(json);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must be valid base64-encoded JSON',
          });
        }
      }),
    NEXT_PUBLIC_API_URL: z.string().url('NEXT_PUBLIC_API_URL must be a valid URL'),
    GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required').optional(),
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required').optional(),
    OPENAI_BASE_URL: z
      .string()
      .url('OPENAI_BASE_URL must be a valid URL')
      .optional()
      .default('https://models.inference.ai.azure.com'),
  })
  .refine((data) => data.GITHUB_TOKEN || data.OPENAI_API_KEY, {
    message: 'Either GITHUB_TOKEN or OPENAI_API_KEY must be provided',
    path: ['GITHUB_TOKEN'],
  });

export const env = envSchema.parse(process.env);
