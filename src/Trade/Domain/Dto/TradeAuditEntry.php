<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

use Statly\Trade\Domain\Enum\TradeErrorCode;
use Statly\Trade\Domain\Enum\TradeEvent;

final readonly class TradeAuditEntry
{
    /**
     * @param array<string, mixed> $payload
     */
    public function __construct(
        public TradeEvent $event,
        public string $actorUserId,
        public array $payload,
        public ?TradeErrorCode $errorCode,
        public string $createdAt
    ) {}
}
