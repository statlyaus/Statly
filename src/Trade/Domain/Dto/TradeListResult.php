<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

final readonly class TradeListResult
{
    /**
     * @param list<TradeSummary> $trades
     */
    public function __construct(
        public array $trades
    ) {}
}
