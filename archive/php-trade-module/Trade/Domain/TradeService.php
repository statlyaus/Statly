<?php

declare(strict_types=1);

namespace Statly\Trade\Domain;

use LogicException;
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

final class TradeService implements TradeServiceInterface
{
    public function __construct(
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
        throw new LogicException('TradeService::propose not implemented.');
    }

    public function accept(TradeActionRequest $request): TradeResult
    {
        throw new LogicException('TradeService::accept not implemented.');
    }

    public function decline(TradeActionRequest $request): TradeResult
    {
        throw new LogicException('TradeService::decline not implemented.');
    }

    public function cancel(TradeActionRequest $request): TradeResult
    {
        throw new LogicException('TradeService::cancel not implemented.');
    }

    public function getDetails(string $tradeId, string $actorUserId): TradeDetails
    {
        throw new LogicException('TradeService::getDetails not implemented.');
    }

    public function list(TradeListFilter $filter, string $actorUserId): TradeListResult
    {
        throw new LogicException('TradeService::list not implemented.');
    }
}
