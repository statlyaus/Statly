<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

final readonly class TradeItemInput
{
    public function __construct(
        public string $fromUserId,
        public string $toUserId,
        public string $playerId
    ) {}
}
