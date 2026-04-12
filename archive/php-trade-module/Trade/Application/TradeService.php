<?php

declare(strict_types=1);

namespace Statly\Trade\Application;

use Statly\Trade\Application\Contract\TransactionManagerInterface;
use Statly\Trade\Domain\Contract\LockoutServiceInterface;
use Statly\Trade\Domain\Contract\SquadServiceInterface;
use Statly\Trade\Domain\Contract\TradeActionRepositoryInterface;
use Statly\Trade\Domain\Contract\TradeAuditServiceInterface;
use Statly\Trade\Domain\Contract\TradeItemRepositoryInterface;
use Statly\Trade\Domain\Contract\TradePlayerLockRepositoryInterface;
use Statly\Trade\Domain\Contract\TradeRepositoryInterface;
use Statly\Trade\Domain\Contract\TradeServiceInterface;
use Statly\Trade\Domain\Contract\TradeValidatorInterface;
use Statly\Trade\Domain\Dto\TradeActionRequest;
use Statly\Trade\Domain\Dto\TradeCreateRequest;
use Statly\Trade\Domain\Dto\TradeDetails;
use Statly\Trade\Domain\Dto\TradeListFilter;
use Statly\Trade\Domain\Dto\TradeListResult;
use Statly\Trade\Domain\Dto\TradeResult;
use Statly\Trade\Domain\Enum\TradeEvent;
use Statly\Trade\Domain\Enum\TradeStatus;
use Statly\Trade\Domain\Exception\IdempotencyConflictException;
use Statly\Trade\Domain\Exception\PlayerPendingTradeException;
use Statly\Trade\Domain\Exception\TradeNotFoundException;
use Statly\Trade\Domain\Exception\UnauthorizedTradeActionException;

final class TradeService implements TradeServiceInterface
{
    public function __construct(
        private readonly TransactionManagerInterface $transactionManager,
        private readonly TradeRepositoryInterface $tradeRepository,
        private readonly TradeItemRepositoryInterface $tradeItemRepository,
        private readonly TradePlayerLockRepositoryInterface $tradePlayerLockRepository,
        private readonly TradeActionRepositoryInterface $tradeActionRepository,
        private readonly TradeAuditServiceInterface $tradeAuditService,
        private readonly TradeValidatorInterface $tradeValidator,
        private readonly LockoutServiceInterface $lockoutService,
        private readonly SquadServiceInterface $squadService
    ) {}

    public function propose(TradeCreateRequest $request): TradeResult
    {
        return $this->transactionManager->run(function () use ($request): TradeResult {
            $existing = $this->tradeRepository->findIdempotencyRecordByRequestId(
                $request->requestId,
                $request->proposerUserId
            );
            if ($existing !== null) {
                $requestHash = $this->computeRequestPayloadHash($request);
                if ($existing->requestPayloadHash !== $requestHash) {
                    throw new IdempotencyConflictException();
                }

                return new TradeResult($existing->tradeId, $existing->status);
            }

            $this->lockoutService->assertTradeWindowOpen($request->leagueId, $request->roundId);
            $this->tradeValidator->validateProposal($request);

            $trade = $this->tradeRepository->create($request, TradeStatus::PROPOSED);
            $this->tradeItemRepository->addItems($trade->tradeId, $request->items);

            $playerIds = $this->extractPlayerIds($request->items);
            $this->tradePlayerLockRepository->ensureLocks($trade->tradeId, $playerIds);

            if ($request->parentTradeId !== null) {
                $parent = $this->tradeRepository->findByIdForUpdate($request->parentTradeId);
                if ($parent === null) {
                    throw new TradeNotFoundException();
                }

                if ($request->proposerUserId !== $parent->recipientUserId) {
                    throw new UnauthorizedTradeActionException();
                }

                $this->tradeValidator->assertTransition($parent->status, TradeStatus::SUPERSEDED);

                [$sharedPlayerIds, $newPlayerIds, $removedPlayerIds] = $this->splitPlayerSets(
                    $parent->items,
                    $request->items
                );

                $this->tradePlayerLockRepository->transferLocks(
                    $parent->tradeId,
                    $trade->tradeId,
                    $sharedPlayerIds
                );
                $this->tradePlayerLockRepository->ensureLocks($trade->tradeId, $newPlayerIds);
                $this->tradePlayerLockRepository->releaseLocksForPlayers($parent->tradeId, $removedPlayerIds);

                $this->tradeRepository->setSupersededBy($parent->tradeId, $trade->tradeId);
                $this->tradeRepository->updateStatus($parent->tradeId, TradeStatus::SUPERSEDED);

                $this->tradeAuditService->record(
                    $parent->tradeId,
                    TradeEvent::TRADE_COUNTERED,
                    $request->proposerUserId,
                    ['supersededBy' => $trade->tradeId]
                );
            }

            $this->tradeAuditService->record(
                $trade->tradeId,
                TradeEvent::TRADE_PROPOSED,
                $request->proposerUserId,
                [
                    'items' => $request->items,
                    'note' => $request->note,
                    'ruleVersions' => $request->ruleVersions,
                ]
            );

            return new TradeResult($trade->tradeId, TradeStatus::PROPOSED);
        });
    }

    public function accept(TradeActionRequest $request): TradeResult
    {
        return $this->transactionManager->run(function () use ($request): TradeResult {
            $trade = $this->requireTradeForUpdate($request->tradeId);

            $this->lockoutService->assertTradeWindowOpen($trade->leagueId, $trade->roundId);
            $this->tradeValidator->validateAccept($trade, $request->actorUserId);
            $recorded = $this->tradeActionRepository->recordAction(
                $trade->tradeId,
                'ACCEPT',
                $request->requestId,
                $request->actorUserId
            );
            if (!$recorded) {
                return new TradeResult($trade->tradeId, $trade->status);
            }

            $playerIds = $this->extractPlayerIds($trade->items);
            $this->assertLocksMatchTrade($trade->tradeId, $playerIds);

            // The underlying squad service must enforce roster row locks atomically.
            $this->squadService->applyTrade($trade->tradeId);
            $this->tradeRepository->updateStatus($trade->tradeId, TradeStatus::EXECUTED);

            $this->tradeAuditService->record(
                $trade->tradeId,
                TradeEvent::TRADE_ACCEPTED,
                $request->actorUserId,
                ['requestId' => $request->requestId]
            );

            $this->tradeAuditService->record(
                $trade->tradeId,
                TradeEvent::TRADE_EXECUTED,
                $request->actorUserId,
                ['requestId' => $request->requestId]
            );

            $this->tradePlayerLockRepository->releaseLocks($trade->tradeId);

            return new TradeResult($trade->tradeId, TradeStatus::EXECUTED);
        });
    }

    public function decline(TradeActionRequest $request): TradeResult
    {
        return $this->transactionManager->run(function () use ($request): TradeResult {
            $trade = $this->requireTradeForUpdate($request->tradeId);

            $this->tradeValidator->validateDecline($trade, $request->actorUserId);
            $recorded = $this->tradeActionRepository->recordAction(
                $trade->tradeId,
                'DECLINE',
                $request->requestId,
                $request->actorUserId
            );
            if (!$recorded) {
                return new TradeResult($trade->tradeId, $trade->status);
            }

            $this->tradeRepository->updateStatus($trade->tradeId, TradeStatus::DECLINED);
            $this->tradePlayerLockRepository->releaseLocks($trade->tradeId);

            $this->tradeAuditService->record(
                $trade->tradeId,
                TradeEvent::TRADE_DECLINED,
                $request->actorUserId,
                ['requestId' => $request->requestId]
            );

            return new TradeResult($trade->tradeId, TradeStatus::DECLINED);
        });
    }

    public function cancel(TradeActionRequest $request): TradeResult
    {
        return $this->transactionManager->run(function () use ($request): TradeResult {
            $trade = $this->requireTradeForUpdate($request->tradeId);

            $this->tradeValidator->validateCancel($trade, $request->actorUserId);
            $recorded = $this->tradeActionRepository->recordAction(
                $trade->tradeId,
                'CANCEL',
                $request->requestId,
                $request->actorUserId
            );
            if (!$recorded) {
                return new TradeResult($trade->tradeId, $trade->status);
            }

            $this->tradeRepository->updateStatus($trade->tradeId, TradeStatus::CANCELLED);
            $this->tradePlayerLockRepository->releaseLocks($trade->tradeId);

            $this->tradeAuditService->record(
                $trade->tradeId,
                TradeEvent::TRADE_CANCELLED,
                $request->actorUserId,
                ['requestId' => $request->requestId]
            );

            return new TradeResult($trade->tradeId, TradeStatus::CANCELLED);
        });
    }

    public function getDetails(string $tradeId, string $actorUserId): TradeDetails
    {
        $trade = $this->requireTrade($tradeId);

        if ($actorUserId !== $trade->proposerUserId && $actorUserId !== $trade->recipientUserId) {
            throw new UnauthorizedTradeActionException();
        }

        return $trade;
    }

    public function list(TradeListFilter $filter, string $actorUserId): TradeListResult
    {
        if ($filter->userId !== null && $filter->userId !== $actorUserId) {
            throw new UnauthorizedTradeActionException();
        }

        return $this->tradeRepository->list($filter);
    }

    /**
     * @param list<\Statly\Trade\Domain\Dto\TradeItemInput> $items
     * @return list<string>
     */
    private function extractPlayerIds(array $items): array
    {
        $playerIds = [];
        foreach ($items as $item) {
            $playerIds[] = $item->playerId;
        }

        return array_values(array_unique($playerIds));
    }

    /**
     * @param list<\Statly\Trade\Domain\Dto\TradeItemInput> $parentItems
     * @param list<\Statly\Trade\Domain\Dto\TradeItemInput> $childItems
     * @return array{0: list<string>, 1: list<string>, 2: list<string>}
     */
    private function splitPlayerSets(array $parentItems, array $childItems): array
    {
        $parentPlayerIds = $this->extractPlayerIds($parentItems);
        $childPlayerIds = $this->extractPlayerIds($childItems);

        $sharedPlayerIds = array_values(array_intersect($parentPlayerIds, $childPlayerIds));
        $newPlayerIds = array_values(array_diff($childPlayerIds, $parentPlayerIds));
        $removedPlayerIds = array_values(array_diff($parentPlayerIds, $childPlayerIds));

        return [$sharedPlayerIds, $newPlayerIds, $removedPlayerIds];
    }

    /**
     * @param list<string> $playerIds
     */
    private function assertLocksMatchTrade(string $tradeId, array $playerIds): void
    {
        $locks = $this->tradePlayerLockRepository->getLocks($playerIds);

        foreach ($playerIds as $playerId) {
            if (!isset($locks[$playerId]) || $locks[$playerId] !== $tradeId) {
                throw new PlayerPendingTradeException();
            }
        }
    }

    private function requireTradeForUpdate(string $tradeId): TradeDetails
    {
        $trade = $this->tradeRepository->findByIdForUpdate($tradeId);
        if ($trade === null) {
            throw new TradeNotFoundException();
        }

        return $trade;
    }

    private function requireTrade(string $tradeId): TradeDetails
    {
        $trade = $this->tradeRepository->findById($tradeId);
        if ($trade === null) {
            throw new TradeNotFoundException();
        }

        return $trade;
    }

    private function computeRequestPayloadHash(TradeCreateRequest $request): string
    {
        $items = array_map(
            static fn (\Statly\Trade\Domain\Dto\TradeItemInput $item): array => [
                'from' => $item->fromUserId,
                'to' => $item->toUserId,
                'player' => $item->playerId,
            ],
            $request->items
        );

        usort(
            $items,
            static fn (array $a, array $b): int => [$a['from'], $a['to'], $a['player']]
                <=> [$b['from'], $b['to'], $b['player']]
        );

        $ruleVersions = $request->ruleVersions;
        sort($ruleVersions);

        $payload = [
            'leagueId' => $request->leagueId,
            'roundId' => $request->roundId,
            'proposerUserId' => $request->proposerUserId,
            'recipientUserId' => $request->recipientUserId,
            'parentTradeId' => $request->parentTradeId,
            'note' => $request->note,
            'items' => $items,
            'ruleVersions' => $ruleVersions,
        ];

        return hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES));
    }
}
