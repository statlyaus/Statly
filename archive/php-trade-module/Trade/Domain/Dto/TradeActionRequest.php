<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

final readonly class TradeActionRequest
{
    public function __construct(
        public string $requestId,
        public string $tradeId,
        public string $actorUserId
    ) {}
}
