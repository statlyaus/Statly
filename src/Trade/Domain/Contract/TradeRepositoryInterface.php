<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

use Statly\Trade\Domain\Dto\TradeCreateRequest;
use Statly\Trade\Domain\Dto\TradeDetails;
use Statly\Trade\Domain\Dto\TradeIdempotencyRecord;
use Statly\Trade\Domain\Dto\TradeListFilter;
use Statly\Trade\Domain\Dto\TradeListResult;
use Statly\Trade\Domain\Enum\TradeStatus;

interface TradeRepositoryInterface
{
    public function create(TradeCreateRequest $request, TradeStatus $status): TradeDetails;

    public function findById(string $tradeId): ?TradeDetails;

    public function findByIdForUpdate(string $tradeId): ?TradeDetails;

    public function findIdempotencyRecordByRequestId(
        string $requestId,
        string $proposerUserId
    ): ?TradeIdempotencyRecord;

    public function list(TradeListFilter $filter): TradeListResult;

    public function updateStatus(string $tradeId, TradeStatus $status): void;

    public function setSupersededBy(string $tradeId, string $supersededByTradeId): void;
}
