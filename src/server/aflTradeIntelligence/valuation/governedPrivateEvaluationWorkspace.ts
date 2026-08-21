import type {
  GovernedPrivateEvaluationAutomatedStageRequest,
  GovernedPrivateEvaluationAutomatedStageResult,
  GovernedPrivateEvaluationExecuteRequest,
  GovernedPrivateEvaluationExecuteResult,
  GovernedPrivateEvaluationInspectRequest,
  GovernedPrivateEvaluationInspectResult,
  GovernedPrivateEvaluationReadRequest,
  GovernedPrivateEvaluationReadResult,
} from './internal/governedPrivateEvaluationWorkspaceContracts';

export type {
  GovernedPrivateEvaluationAutomatedStageRequest,
  GovernedPrivateEvaluationAutomatedStageResult,
  GovernedPrivateEvaluationExecuteRequest,
  GovernedPrivateEvaluationExecuteResult,
  GovernedPrivateEvaluationInspectRequest,
  GovernedPrivateEvaluationInspectResult,
  GovernedPrivateEvaluationReadRequest,
  GovernedPrivateEvaluationReadResult,
};

export interface GovernedPrivateEvaluationWorkspace {
  stageAutomated(
    request: GovernedPrivateEvaluationAutomatedStageRequest
  ): Promise<GovernedPrivateEvaluationAutomatedStageResult>;
  inspect(
    request: GovernedPrivateEvaluationInspectRequest
  ): Promise<GovernedPrivateEvaluationInspectResult>;
  execute(
    request: GovernedPrivateEvaluationExecuteRequest
  ): Promise<GovernedPrivateEvaluationExecuteResult>;
  read(request: GovernedPrivateEvaluationReadRequest): Promise<GovernedPrivateEvaluationReadResult>;
}
