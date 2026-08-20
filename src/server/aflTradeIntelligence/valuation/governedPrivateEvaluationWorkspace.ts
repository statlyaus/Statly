import type {
  GovernedPrivateEvaluationExecuteRequest,
  GovernedPrivateEvaluationExecuteResult,
  GovernedPrivateEvaluationInspectRequest,
  GovernedPrivateEvaluationInspectResult,
  GovernedPrivateEvaluationReadRequest,
  GovernedPrivateEvaluationReadResult,
} from './internal/governedPrivateEvaluationWorkspaceContracts';

export type {
  GovernedPrivateEvaluationExecuteRequest,
  GovernedPrivateEvaluationExecuteResult,
  GovernedPrivateEvaluationInspectRequest,
  GovernedPrivateEvaluationInspectResult,
  GovernedPrivateEvaluationReadRequest,
  GovernedPrivateEvaluationReadResult,
};

export interface GovernedPrivateEvaluationWorkspace {
  inspect(
    request: GovernedPrivateEvaluationInspectRequest
  ): Promise<GovernedPrivateEvaluationInspectResult>;
  execute(
    request: GovernedPrivateEvaluationExecuteRequest
  ): Promise<GovernedPrivateEvaluationExecuteResult>;
  read(request: GovernedPrivateEvaluationReadRequest): Promise<GovernedPrivateEvaluationReadResult>;
}
