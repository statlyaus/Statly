<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

use Statly\Trade\Domain\Dto\TradeActionRequest;
use Statly\Trade\Domain\Dto\TradeCreateRequest;
use Statly\Trade\Domain\Dto\TradeDetails;
use Statly\Trade\Domain\Dto\TradeListFilter;
use Statly\Trade\Domain\Dto\TradeListResult;
use Statly\Trade\Domain\Dto\TradeResult;

interface TradeServiceInterface
{
    public function propose(TradeCreateRequest $request): TradeResult;

    public function accept(TradeActionRequest $request): TradeResult;

    public function decline(TradeActionRequest $request): TradeResult;

    public function cancel(TradeActionRequest $request): TradeResult;

    public function getDetails(string $tradeId, string $actorUserId): TradeDetails;

    public function list(TradeListFilter $filter, string $actorUserId): TradeListResult;
}
