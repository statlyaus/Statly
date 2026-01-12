<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

use Statly\Trade\Domain\Dto\TradeCreateRequest;
use Statly\Trade\Domain\Dto\TradeDetails;
use Statly\Trade\Domain\Enum\TradeStatus;

interface TradeValidatorInterface
{
    public function validateProposal(TradeCreateRequest $request): void;

    public function validateAccept(TradeDetails $trade, string $actorUserId): void;

    public function validateDecline(TradeDetails $trade, string $actorUserId): void;

    public function validateCancel(TradeDetails $trade, string $actorUserId): void;

    public function assertTransition(TradeStatus $fromStatus, TradeStatus $toStatus): void;
}
