<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

use Statly\Trade\Domain\Enum\TradeStatus;

final readonly class TradeResult
{
    public function __construct(
        public string $tradeId,
        public TradeStatus $status
    ) {}
}
