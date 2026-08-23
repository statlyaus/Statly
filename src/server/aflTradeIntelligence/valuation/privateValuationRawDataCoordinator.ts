import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  aflTradePrivateValuationCaptureSourceRoleSchema,
  getAflTradePrivateValuationCaptureSourceRole,
  parseAflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureSourceRole,
} from './privateValuationCaptureBinding';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';

const claimSchema = z
  .object({
    claimId: z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/),
    leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const capturedNormalizationSchema = z
  .object({
    normalizationRunId: z.string().regex(/^provider-normalization-run:[a-f0-9]{64}$/),
  })
  .strict();

export interface AflTradePrivateValuationCaptureBindingRepository {
  load(
    request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>,
    sourceRole?: AflTradePrivateValuationCaptureSourceRole
  ): Promise<AflTradePrivateValuationCaptureBinding | null>;
  accept(input: {
    readonly request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>;
    readonly claim: z.infer<typeof claimSchema>;
    readonly sourceRole?: AflTradePrivateValuationCaptureSourceRole;
    readonly normalizationRunId: string;
  }): Promise<AflTradePrivateValuationCaptureBinding>;
}

function requireBindingForRequest(
  binding: AflTradePrivateValuationCaptureBinding,
  request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>,
  sourceRole: AflTradePrivateValuationCaptureSourceRole
): AflTradePrivateValuationCaptureBinding {
  const parsed = parseAflTradePrivateValuationCaptureBinding(binding);
  if (canonicalizeAflTradeJson(parsed.content.request) !== canonicalizeAflTradeJson(request)) {
    throw new TypeError('Accepted capture binding conflicts with the requested dispatch.');
  }
  if (getAflTradePrivateValuationCaptureSourceRole(parsed) !== sourceRole) {
    throw new TypeError('Accepted capture binding conflicts with the requested source role.');
  }
  return parsed;
}

export function createAflTradePrivateValuationRawDataCoordinator(dependencies: {
  readonly captureBindings: AflTradePrivateValuationCaptureBindingRepository;
  readonly sourceRole?: AflTradePrivateValuationCaptureSourceRole;
  readonly capture: (input: {
    readonly request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>;
    readonly claim: z.infer<typeof claimSchema>;
    readonly sourceRole: AflTradePrivateValuationCaptureSourceRole;
  }) => Promise<z.infer<typeof capturedNormalizationSchema>>;
}) {
  return {
    async run(input: {
      readonly request: z.input<typeof aflTradePrivateValuationDispatchRequestSchema>;
      readonly claim: z.input<typeof claimSchema>;
    }) {
      const request = aflTradePrivateValuationDispatchRequestSchema.parse(input.request);
      const claim = claimSchema.parse(input.claim);
      const sourceRole = aflTradePrivateValuationCaptureSourceRoleSchema.parse(
        dependencies.sourceRole ?? 'factual_input'
      );
      const retained = await dependencies.captureBindings.load(request, sourceRole);
      if (retained !== null) {
        const binding = requireBindingForRequest(retained, request, sourceRole);
        return {
          state: 'capture_accepted' as const,
          requestId: request.requestId,
          binding,
          idempotentReplay: true,
        };
      }

      const captured = capturedNormalizationSchema.parse(
        await dependencies.capture({ request, claim, sourceRole })
      );
      const binding = requireBindingForRequest(
        await dependencies.captureBindings.accept({
          request,
          claim,
          sourceRole,
          normalizationRunId: captured.normalizationRunId,
        }),
        request,
        sourceRole
      );
      if (binding.content.dispatchClaimId !== claim.claimId) {
        throw new TypeError('Accepted capture binding disagrees with the live dispatch claim.');
      }
      if (binding.content.normalizationRunId !== captured.normalizationRunId) {
        throw new TypeError('Accepted capture binding disagrees with the captured normalization.');
      }
      return {
        state: 'capture_accepted' as const,
        requestId: request.requestId,
        binding,
        idempotentReplay: false,
      };
    },
  };
}
